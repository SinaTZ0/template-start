package commands

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"deploy/internal/backup"
	"deploy/internal/certs"
	"deploy/internal/envfile"
	"deploy/internal/interrupt"
	"deploy/internal/offsite"
	"deploy/internal/ports"
	"deploy/internal/project"
	"deploy/internal/stack"
	"deploy/internal/ui"
)

/*===== Recover =====*/

// Recover sets up a server from the off-site backups (package offsite), for a site that moves to a new server or
// lost its old one: .env comes from the bucket's encrypted copy, then the newest database dump and media archive are
// loaded before the first build, so the app starts on the old data, with the old secrets (sessions stay valid).
// Outside a checkout it clones the repository first, as Set up does.
//
// It only runs on a server whose database is empty. An .env that's already in the checkout is used as it is: that's
// a Recover that stopped part-way, or an operator who kept their own copy because the bucket has none.
func (t *Tool) Recover(args []string) error {
	if err := noArgs("recover", args); err != nil {
		return err
	}
	if !ui.Interactive {
		return ui.Fail("Recover asks for the bucket and .env's password, so it needs a terminal.")
	}
	if err := stack.RequireTools(); err != nil {
		return err
	}
	if !t.P.IsCheckout() {
		return t.cloneAndContinue("recover")
	}
	if t.S.State("app") != "missing" {
		return ui.Fail("This server already runs the app. To bring a backup into it, use Restore.")
	}
	if err := ports.CheckFree(); err != nil {
		return err
	}
	env := t.P.EnvFile()
	ctx := interrupt.Context()

	/*------ The bucket and .env ------*/
	var config *offsite.Config
	var content []byte
	if t.P.IsSetUp() {
		ui.Info("Using the .env that's already here.")
		var err error
		if config, err = offsite.Load(env); err != nil {
			return ui.Fail("The .env here has its off-site backups half set: %v.", err)
		}
		if config == nil {
			return ui.Fail("The .env here names no bucket (BACKUP_S3_ENDPOINT and the settings after it), so there's " +
				"nowhere to fetch the backups from. Fill them in, or remove .env to be asked.")
		}
	} else {
		var err error
		if config, err = t.recoverBucket(); err != nil {
			return err
		}
		if content, err = t.recoverEnv(config); err != nil {
			return err
		}
	}

	/*------ The backups ------*/
	var objects []offsite.Object
	err := ui.Spin("Listing the backups in the bucket", func(io.Writer) (err error) {
		objects, err = config.List(ctx)
		return err
	})
	if err == interrupt.ErrInterrupted {
		return err
	}
	if err != nil {
		return ui.Fail("Can't list the bucket: %v.", err)
	}
	var db, media *offsite.Object
	for i, o := range objects {
		if o.IsDB() && db == nil {
			db = &objects[i]
		}
		if o.IsMedia() && media == nil {
			media = &objects[i]
		}
	}
	if db == nil {
		return ui.Fail("There's no database backup in %s under %s, so there's nothing to recover. Nothing was changed.",
			config.Bucket, config.Prefix)
	}
	describe := func(o *offsite.Object) string {
		text := fmt.Sprintf("%s (%s)", o.Name, backup.Size(o.Size))
		if made, ok := backup.MadeAt(o.Name); ok {
			text += ", made " + made.Format("2006-01-02 15:04")
		}
		return text
	}
	ui.Step("What comes back")
	if content != nil {
		ui.Info("  .env        the copy in the bucket (%d settings)", len(envfile.Parse(string(content))))
	}
	ui.Info("  Database    %s", describe(db))
	if media != nil {
		ui.Info("  Media       %s", describe(media))
	} else {
		ui.Warn("  Media       none in the bucket: the site comes back without its uploaded images")
	}
	ui.Info("  What the old server wrote after these were made isn't in them.")
	ok, err := ui.Confirm("Recover this server from these?", true)
	if err != nil {
		return err
	}
	if !ok {
		return ui.Fail("Nothing was changed.")
	}

	/*------ Write .env ------*/
	// From here .env exists: a Recover that stops below is run again and picks up from it.
	if content != nil {
		if err := os.WriteFile(env, content, 0o600); err != nil {
			return err
		}
		ui.OK(".env written, with the old server's secrets.")
	}
	if err := t.Env.Check(""); err != nil {
		return err
	}
	if err := t.recoverCertificate(); err != nil {
		return err
	}
	dir, err := t.recoverBackupDir()
	if err != nil {
		return err
	}

	/*------ Download ------*/
	ui.Step("Downloading")
	files := map[*offsite.Object]string{}
	for _, o := range []*offsite.Object{db, media} {
		if o == nil {
			continue
		}
		// A Recover run again finds what the last one downloaded.
		if here := filepath.Join(dir, o.Name); sizeOf(here) == o.Size {
			ui.OK("%s is already in %s", o.Name, dir)
			files[o] = here
			continue
		}
		path := ""
		err := ui.Spin(fmt.Sprintf("Downloading %s (%s)", o.Name, backup.Size(o.Size)), func(io.Writer) (err error) {
			path, err = config.Download(ctx, o.Name, dir)
			return err
		})
		if err == interrupt.ErrInterrupted {
			return err
		}
		if err != nil {
			return ui.Fail("%s didn't come from the bucket: %v. Run deploy/deploy.sh recover again: it goes on from here.", o.Name, err)
		}
		ui.OK("%s → %s", o.Name, path)
		files[o] = path
	}

	// Before anything is loaded, so a server that can't build says so while it's still empty.
	ui.Step("Package registries")
	if err := t.checkSources(""); err != nil {
		return err
	}

	/*------ Database ------*/
	// Only the database starts: the app must not run its first requests, nor `migrate` its migrations, on an empty one.
	ui.Step("Starting the database")
	if err := t.S.Run("up", "-d", "db"); err != nil {
		return ui.Fail("The database didn't start (see above). Once it's fixed, run deploy/deploy.sh recover again.")
	}
	if err := ui.Spin("Waiting for the database", func(io.Writer) error {
		return t.S.WaitHealthy("db", 120*time.Second)
	}); err != nil {
		if err == interrupt.ErrInterrupted {
			return err
		}
		return ui.Fail("The database didn't turn healthy. Its logs: deploy/deploy.sh logs db")
	}
	filled, err := backup.HasTables(t.S)
	if err != nil {
		return ui.Fail("Can't look into the database: %v", err)
	}
	if filled {
		// An earlier Recover got this far and stopped in the media or the build.
		hint := ""
		if media != nil {
			hint = "\n  deploy/deploy.sh restore " + media.Name + "   brings the media, once the stack runs"
		}
		return ui.Fail("This server's database already holds data, so it isn't replaced. If an earlier Recover "+
			"stopped after the database:\n  deploy/deploy.sh apply   builds and starts the stack on it%s", hint)
	}
	if err := backup.LoadDB(t.S, files[db]); err != nil {
		return err
	}

	/*------ Media ------*/
	if media != nil {
		ui.Step("Starting the image store")
		if err := t.S.Run("up", "-d", "--no-deps", "seaweedfs"); err != nil {
			return ui.Fail("The image store didn't start (see above). The database is restored; once it's fixed:\n"+
				"  deploy/deploy.sh apply\n  deploy/deploy.sh restore %s", media.Name)
		}
		if err := backup.LoadMedia(t.S, files[media]); err != nil {
			return err
		}
	}

	/*------ Build and start ------*/
	// Migrations newer than the dump run here, and the deploy steps after it: the ledger came back with the database,
	// so the steps the old server hadn't run yet are the pending ones.
	if err := t.S.Deploy(t.Env); err != nil {
		return err
	}
	if err := t.afterDeploy(); err != nil {
		return err
	}

	/*------ Done ------*/
	domain, errorsDomain := envfile.Get(env, "DOMAIN"), envfile.Get(env, "ERRORS_DOMAIN")
	ui.Step("Done")
	ui.Info("  Site          https://%s", domain)
	ui.Info("  Error viewer  https://%s   (its reports stayed on the old server)", errorsDomain)
	ui.Info("")
	ui.Info("  Point the DNS records of both domains at this server, if they aren't yet.")
	if envfile.Get(env, "TLS_MODE") != "files" {
		ui.Info("  The certificates are issued once they do: until then browsers warn.")
	}
	ui.Warn("If the old server still runs, stop it (docker compose -f compose.prod.yaml down, in its checkout) and " +
		"turn its schedule off: its backups go to the same place in the bucket and would mix with this server's.")
	return t.offerSchedule()
}

// recoverBucket asks where the backups are: the store, the keys, and which site's folder in the bucket.
func (t *Tool) recoverBucket() (*offsite.Config, error) {
	ui.Step("The off-site bucket")
	ui.Info("Where the old server copied its backups (its BACKUP_S3_* settings). Keys that can read are enough.")
	config := &offsite.Config{Keep: offsite.DefaultKeep}
	var err error
	if config.Endpoint, err = ui.Ask("Endpoint, as https://…, without the bucket", "", ""); err != nil {
		return nil, err
	}
	if config.Bucket, err = ui.Ask("Bucket", "", ""); err != nil {
		return nil, err
	}
	if config.Region, err = ui.Ask("Region", "us-east-1", ""); err != nil {
		return nil, err
	}
	if config.AccessKey, err = ui.Ask("Access key", "", ""); err != nil {
		return nil, err
	}
	if config.SecretKey, err = ui.AskSecret("Secret key"); err != nil {
		return nil, err
	}
	if config.Endpoint == "" || config.Bucket == "" || config.AccessKey == "" || config.SecretKey == "" {
		return nil, ui.Fail("The endpoint, the bucket and both keys are all needed. Nothing was changed.")
	}

	/*------ Which site ------*/
	var sites []string
	err = ui.Spin("Looking into the bucket", func(io.Writer) (err error) {
		sites, err = config.Sites(interrupt.Context())
		return err
	})
	if err == interrupt.ErrInterrupted {
		return nil, err
	}
	if err != nil {
		return nil, ui.Fail("Can't read the bucket: %v. Nothing was changed.", err)
	}
	switch len(sites) {
	case 0:
		return nil, ui.Fail("The bucket %s holds no site's backups. Nothing was changed.", config.Bucket)
	case 1:
		ui.Info("The bucket holds the backups of %s.", sites[0])
		config.Prefix = sites[0] + "/"
	default:
		n, err := ui.Choose("Which site?", sites)
		if err != nil {
			return nil, err
		}
		config.Prefix = sites[n] + "/"
	}
	return config, nil
}

// recoverEnv fetches the bucket's copy of .env and asks for its password until it opens.
func (t *Tool) recoverEnv(config *offsite.Config) ([]byte, error) {
	ui.Step(".env")
	ui.Info("The bucket's copy of .env is encrypted with the password chosen when off-site backups were set up " +
		"(the old server's BACKUP_ENV_PASSWORD).")
	for {
		password, err := ui.AskSecret("Password of .env's copy")
		if err != nil {
			return nil, err
		}
		var content []byte
		err = ui.Spin("Fetching .env", func(io.Writer) (err error) {
			content, err = config.FetchEnv(interrupt.Context(), strings.TrimSpace(password))
			return err
		})
		switch {
		case err == nil:
			if envfile.Parse(string(content))["DOMAIN"] == "" {
				return nil, ui.Fail("The copy opened, but it isn't an .env of this project (no DOMAIN). Nothing was changed.")
			}
			ui.OK("The password opens it.")
			return content, nil
		case err == interrupt.ErrInterrupted:
			return nil, err
		case errors.Is(err, offsite.ErrWrongPassword):
			ui.Warn("That isn't the password it was encrypted with. Again, or Ctrl-C to stop.")
		case errors.Is(err, offsite.ErrNoEnv):
			return nil, ui.Fail("The bucket has no copy of .env for this site (it was left out when off-site backups "+
				"were set up). Put your own copy of the old server's .env in %s, then run deploy/deploy.sh recover again.", t.P.Root)
		default:
			return nil, ui.Fail(".env didn't come from the bucket: %v. Nothing was changed.", err)
		}
	}
}

// recoverCertificate settles the certificate when the old server used its own: certs/ isn't in any backup, so the
// files are asked for again, or Caddy gets one from Let's Encrypt instead.
func (t *Tool) recoverCertificate() error {
	env := t.P.EnvFile()
	if envfile.Get(env, "TLS_MODE") != "files" {
		return nil
	}
	if _, err := certs.Expiry(t.P.Path("certs", "fullchain.pem")); err == nil {
		return nil
	}
	ui.Step("HTTPS certificate")
	ui.Info("The old server used your own certificate, and its files aren't in the backups.")
	choice, err := ui.Choose("Which certificate?", []string{
		"My own      the folder with the certificate files, copied to this server",
		"Automatic   Let's Encrypt via Caddy (needs ports 80 and 443 open to the internet)",
	})
	if err != nil {
		return err
	}
	if choice == 1 {
		return envfile.Set(env, "TLS_MODE", "auto")
	}
	folder, err := ui.Ask("Folder with your certificate files", "", "")
	if err != nil {
		return err
	}
	return certs.Install(folder, envfile.Get(env, "DOMAIN"), envfile.Get(env, "ERRORS_DOMAIN"), t.P.CertDir())
}

// recoverBackupDir makes the backups' folder, where the downloads go. BACKUP_DIR is the old server's: when it can't
// be made here (another user's home, a disk that isn't mounted), another one is asked for.
func (t *Tool) recoverBackupDir() (string, error) {
	for {
		dir := backup.Dir(t.P)
		err := os.MkdirAll(dir, 0o700)
		if err == nil {
			return dir, nil
		}
		ui.Warn("The old server's folder for backups can't be made here: %v.", err)
		answer, err := ui.Ask("Folder for backups", "./backups", "")
		if err != nil {
			return "", err
		}
		if err := envfile.Set(t.P.EnvFile(), "BACKUP_DIR", project.ExpandHome(answer)); err != nil {
			return "", err
		}
	}
}
