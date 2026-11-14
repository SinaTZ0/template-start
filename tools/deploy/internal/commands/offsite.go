package commands

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"deploy/internal/backup"
	"deploy/internal/envfile"
	"deploy/internal/interrupt"
	"deploy/internal/offsite"
	"deploy/internal/settings"
	"deploy/internal/status"
	"deploy/internal/ui"
)

/*===== Off-site =====*/

// Offsite shows where the off-site copies of the backups go (package offsite) and, on a terminal, sets that up,
// changes it or turns it off. `test` tries the bucket, `list` lists what's in it.
func (t *Tool) Offsite(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	if len(args) > 1 {
		return ui.Usage("offsite takes test or list (see deploy/deploy.sh help)")
	}
	env := t.P.EnvFile()
	config, loadErr := offsite.Load(env)
	if len(args) == 1 {
		switch args[0] {
		case "test", "list":
		default:
			return ui.Usage("Unknown offsite option: %s (test or list)", args[0])
		}
		if loadErr != nil {
			return ui.Fail("Off-site backups are half set up: %v.", loadErr)
		}
		if config == nil {
			return ui.Fail("Off-site backups aren't set up: deploy/deploy.sh offsite, on a terminal.")
		}
		if args[0] == "test" {
			return t.offsiteTest(config)
		}
		return t.offsiteList(config)
	}

	/*------ Show ------*/
	switch {
	case loadErr != nil:
		ui.Warn("Half set up: %v.", loadErr)
	case config == nil:
		ui.Info("  Off-site backups are off: the backups are only on this server, in %s.", backup.Dir(t.P))
	default:
		ui.Info("  %s", status.Offsite(t.P))
		ui.Info("    %s", ui.Dim(fmt.Sprintf("%s, bucket %s, under %s, the newest %d of each kind", config.Endpoint,
			config.Bucket, config.Prefix, config.Keep)))
	}
	if !ui.Interactive {
		return nil
	}
	type action struct {
		label string
		run   func() error
	}
	actions := []action{{"Set up     copy every backup to an S3-compatible bucket", t.offsiteSetup}}
	if config != nil {
		actions = []action{
			{"Test       write to, read from and delete from the bucket", func() error { return t.offsiteTest(config) }},
			{"Copy now   the newest backup of each kind, and .env", func() error { return t.offsiteNewest() }},
			{"List       the backups in the bucket", func() error { return t.offsiteList(config) }},
			{"Change     the bucket, the keys or .env's password", t.offsiteSetup},
			{"Turn off   keep the backups on this server only", t.offsiteOff},
		}
	}
	actions = append(actions, action{"Back", func() error { return nil }})
	labels := make([]string, len(actions))
	for i, a := range actions {
		labels[i] = a.label
	}
	n, err := ui.Choose("What now?", labels)
	if err != nil {
		return err
	}
	return actions[n].run()
}

func (t *Tool) offsiteTest(config *offsite.Config) error {
	err := ui.Spin("Trying the bucket", func(io.Writer) error { return config.Probe(interrupt.Context()) })
	if err == interrupt.ErrInterrupted {
		return err
	}
	if err != nil {
		return ui.Fail("The bucket can't hold the backups: %v.", err)
	}
	ui.OK("The bucket takes, lists, returns and deletes files.")
	return nil
}

func (t *Tool) offsiteList(config *offsite.Config) error {
	var objects []offsite.Object
	err := ui.Spin("Listing the bucket", func(io.Writer) (err error) {
		objects, err = config.List(interrupt.Context())
		return err
	})
	if err == interrupt.ErrInterrupted {
		return err
	}
	if err != nil {
		return ui.Fail("Can't list the bucket: %v.", err)
	}
	if len(objects) == 0 {
		ui.Info("No backups in the bucket under %s yet.", config.Prefix)
		return nil
	}
	for _, o := range objects {
		ui.Info("  %s  %s", o.Name, ui.Dim("("+backup.Size(o.Size)+")"))
	}
	return nil
}

func (t *Tool) offsiteOff() error {
	// Only the endpoint: the rest stays, so turning it on again asks for nothing that was already typed.
	if err := envfile.Set(t.P.EnvFile(), offsite.KeyEndpoint, ""); err != nil {
		return err
	}
	ui.OK("Off-site backups are off. What's in the bucket stays there.")
	return nil
}

// offsiteSetup asks for the bucket and saves it once a test write, read and delete worked, so a typo shows now and
// not as a failed upload at night.
func (t *Tool) offsiteSetup() error {
	env := t.P.EnvFile()
	current := func(key string) string { return strings.TrimSpace(envfile.Get(env, key)) }
	ui.Info("Any S3-compatible store will do (Backblaze B2, Cloudflare R2, Wasabi, AWS S3, MinIO on another server).")
	ui.Info("Create a private bucket there, and keys that may read, write and delete in it.")

	/*------ Ask ------*/
	config := &offsite.Config{Keep: offsite.DefaultKeep, Prefix: current("DOMAIN") + "/"}
	var err error
	if config.Endpoint, err = ui.Ask("Endpoint, as https://…, without the bucket", current(offsite.KeyEndpoint), ""); err != nil {
		return err
	}
	if config.Bucket, err = ui.Ask("Bucket", current(offsite.KeyBucket), ""); err != nil {
		return err
	}
	if config.Region, err = ui.Ask("Region", or(current(offsite.KeyRegion), "us-east-1"), ""); err != nil {
		return err
	}
	if config.AccessKey, err = ui.Ask("Access key", current(offsite.KeyAccessKey), ""); err != nil {
		return err
	}
	question := "Secret key"
	if current(offsite.KeySecretKey) != "" {
		question += " (Enter keeps the one in .env)"
	}
	if config.SecretKey, err = ui.AskSecret(question); err != nil {
		return err
	}
	config.SecretKey = or(config.SecretKey, current(offsite.KeySecretKey))
	if config.Endpoint == "" || config.Bucket == "" || config.AccessKey == "" || config.SecretKey == "" {
		return ui.Fail("The endpoint, the bucket and both keys are all needed. Nothing was changed.")
	}

	/*------ Try ------*/
	if err := t.offsiteTest(config); err != nil {
		if err != interrupt.ErrInterrupted {
			ui.PrintError(err)
			return ui.Fail("Nothing was changed.")
		}
		return err
	}

	/*------ .env's password ------*/
	password, generated, err := t.offsitePassword(current(offsite.KeyPassword))
	if err != nil {
		return err
	}

	/*------ Save ------*/
	for _, kv := range [][2]string{
		{offsite.KeyEndpoint, config.Endpoint}, {offsite.KeyBucket, config.Bucket}, {offsite.KeyRegion, config.Region},
		{offsite.KeyAccessKey, config.AccessKey}, {offsite.KeySecretKey, config.SecretKey},
		{offsite.KeyPassword, password},
	} {
		if err := envfile.Set(env, kv[0], kv[1]); err != nil {
			return err
		}
	}
	ui.OK("Off-site backups are on: every backup made from now on is copied to %s.", config.Bucket)
	if generated {
		ui.Info("The password of .env's copy, shown once:")
		ui.Private("    %s", password)
	}
	if password != "" {
		ui.Warn("Keep that password somewhere that isn't this server (a password manager). After a lost server it's " +
			"the only way to read .env's copy, and with it the database password and the keys sessions are signed with.")
	} else {
		ui.Warn(".env isn't copied. Keep a copy of it yourself: a restored database is no use without its secrets.")
	}
	ok, err := ui.Confirm("Copy the newest backups there now?", true)
	if err != nil || !ok {
		return err
	}
	return t.offsiteNewest()
}

// offsitePassword settles the password .env's copy is encrypted with: the current one, a generated one, a typed one,
// or none (.env stays out of the bucket). generated says it has to be shown.
func (t *Tool) offsitePassword(current string) (password string, generated bool, err error) {
	ui.Info("A copy of .env goes along, encrypted with a password, since nothing else holds the server's secrets.")
	options := []string{"Generate a password", "Type one", "Leave .env out"}
	if current != "" {
		options = append([]string{"Keep the current password"}, options...)
	}
	n, err := ui.Choose("The copy of .env", options)
	if err != nil {
		return "", false, err
	}
	switch options[n] {
	case "Keep the current password":
		return current, false, nil
	case "Generate a password":
		return settings.Secret(16), true, nil
	case "Leave .env out":
		return "", false, nil
	}
	for {
		if password, err = ui.AskSecret("Password (12 characters or more)"); err != nil {
			return "", false, err
		}
		problem := offsite.CheckPassword(password)
		if problem == nil {
			return password, false, nil
		}
		ui.Warn("That password won't do: %v.", problem)
	}
}

// offsiteNewest copies the newest database dump and media archive on this server to the bucket.
func (t *Tool) offsiteNewest() error {
	var files []string
	db, media := false, false
	for _, f := range backup.List(backup.Dir(t.P)) {
		if (f.IsDB() && !db) || (f.IsMedia() && !media) {
			files = append(files, f.Path)
		}
		db, media = db || f.IsDB(), media || f.IsMedia()
	}
	if len(files) == 0 {
		ui.Info("There's no backup on this server yet: deploy/deploy.sh backup makes one and copies it.")
		return nil
	}
	return t.offsiteCopy(files)
}

// offsiteCopy copies backups that were just made to the bucket, with .env, and removes the ones past
// BACKUP_S3_KEEP there. It does nothing when off-site backups are off. A failure here is the command's failure, so
// cron's run tells the chat, but the backup on this server stays and counts.
func (t *Tool) offsiteCopy(files []string) error {
	config, err := offsite.Load(t.P.EnvFile())
	if err != nil {
		return ui.Fail("The backup is on this server, but off-site backups are half set up: %v.", err)
	}
	if config == nil {
		return nil
	}
	ui.Step("Copying off-site")
	ctx := interrupt.Context()
	failed := func(what string, err error) error {
		if err == interrupt.ErrInterrupted {
			return err
		}
		return ui.Fail("The backup is on this server, but %s didn't reach the bucket %s: %v.", what, config.Bucket, err)
	}
	for _, file := range files {
		name := filepath.Base(file)
		title := fmt.Sprintf("Uploading %s (%s)", name, backup.Size(sizeOf(file)))
		if err := ui.Spin(title, func(io.Writer) error { return config.Upload(ctx, file) }); err != nil {
			return failed(name, err)
		}
	}
	if err := ui.Spin("Uploading .env, encrypted", func(io.Writer) error {
		return config.UploadEnv(ctx, t.P.EnvFile())
	}); err != nil {
		return failed(".env", err)
	}
	// From here the copies are there: an old one that couldn't be removed is a warning.
	offsite.Mark(offsite.StateFile(t.P.Root))
	if _, err := config.Prune(ctx); err != nil {
		ui.Warn("The old backups in the bucket couldn't be removed: %v.", err)
	}
	with := ", with .env"
	if config.Password == "" {
		with = ", without .env (no BACKUP_ENV_PASSWORD)"
	}
	ui.OK("Off-site → %s/%s (%d %s%s)", config.Bucket, config.Prefix, len(files), plural(len(files), "file"), with)
	return nil
}

func sizeOf(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func plural(n int, word string) string {
	if n == 1 {
		return word
	}
	return word + "s"
}
