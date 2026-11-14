package commands

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"deploy/internal/backup"
	"deploy/internal/envfile"
	"deploy/internal/interrupt"
	"deploy/internal/offsite"
	"deploy/internal/project"
	"deploy/internal/ui"
)

// Backup backs up the database, the media, or both. Without a terminal the database is the default; `--dir` is
// remembered in .env, so the next run (and cron) writes to the same place. With off-site backups on, what it made is
// copied to the bucket (offsiteCopy).
func (t *Tool) Backup(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	what, dir := "", ""
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--all":
			what = "all"
		case "--db":
			what = "db"
		case "--media":
			what = "media"
		case "--dir":
			if i+1 >= len(args) {
				return ui.Usage("--dir needs a folder.")
			}
			i++
			dir = args[i]
		default:
			return ui.Usage("Unknown backup option: %s (see deploy/deploy.sh help)", args[i])
		}
	}

	if what == "" {
		what = "db"
		if ui.Interactive {
			n, err := ui.Choose("What to back up?", []string{"Database + media", "Database only", "Media only"})
			if err != nil {
				return err
			}
			what = []string{"all", "db", "media"}[n]
		}
	}
	env := t.P.EnvFile()
	if dir == "" && ui.Interactive {
		var err error
		if dir, err = ui.Ask("Folder for backups", envfile.Get(env, "BACKUP_DIR"), ""); err != nil {
			return err
		}
	}
	if dir != "" {
		dir = project.ExpandHome(dir)
		if dir != envfile.Get(env, "BACKUP_DIR") {
			if err := envfile.Set(env, "BACKUP_DIR", dir); err != nil {
				return err
			}
		}
	}

	dir = backup.Dir(t.P)
	stamp := backup.Stamp()
	var made []string
	if what == "all" || what == "db" {
		path, err := backup.DB(t.S, dir, stamp, "")
		if err != nil {
			return err
		}
		made = append(made, path)
	}
	if what == "all" || what == "media" {
		path, err := backup.Media(t.S, dir, stamp)
		if err != nil {
			// The dump that was made still goes off-site; the media's failure is the one reported.
			_ = t.offsiteCopy(made)
			return err
		}
		made = append(made, path)
	}
	backup.Prune(t.P, dir)
	return t.offsiteCopy(made)
}

// Restore restores a db-… or media-… backup: a file, or the name of one in the backups' folder or, with off-site
// backups on, in the bucket (downloaded first). It asks for the domain to be typed, not just y: this replaces live
// data, and the domain proves it's the server you meant.
func (t *Tool) Restore(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	file, confirmed := "", ""
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--confirm":
			if i+1 >= len(args) {
				return ui.Usage("--confirm needs the domain.")
			}
			i++
			confirmed = args[i]
		case strings.HasPrefix(args[i], "-"):
			return ui.Usage("Unknown restore option: %s (see deploy/deploy.sh help)", args[i])
		default:
			file = args[i]
		}
	}
	domain := envfile.Get(t.P.EnvFile(), "DOMAIN")
	dir := backup.Dir(t.P)

	/*------ Pick ------*/
	if file == "" {
		if !ui.Interactive {
			return ui.Fail("Pass the backup: deploy/deploy.sh restore <file> --confirm %s", domain)
		}
		choices := t.restoreChoices(dir)
		if len(choices) == 0 {
			return ui.Fail("No backups in %s.", dir)
		}
		labels := make([]string, len(choices))
		for i, c := range choices {
			labels[i] = fmt.Sprintf("%s  (%s%s)", c.name, backup.Size(c.size), c.where)
		}
		n, err := ui.Choose("Which backup? (newest first)", labels)
		if err != nil {
			return err
		}
		file = choices[n].name
	}
	file, err := t.restoreFile(file, dir)
	if err != nil {
		return err
	}
	f := backup.File{Path: file}
	kind := ""
	switch {
	case f.IsDB():
		kind = "database"
	case f.IsMedia():
		kind = "media"
	default:
		return ui.Fail("Can't tell what %s holds: backup names start with db- or media-.", file)
	}

	/*------ Confirm ------*/
	ui.Warn("This replaces the current %s with %s.", kind, f.Name())
	typed := confirmed
	if ui.Interactive && confirmed == "" {
		var err error
		if typed, err = ui.Ask(fmt.Sprintf("Type %s to confirm", domain), "", ""); err != nil {
			return err
		}
	}
	if typed != domain {
		return ui.Fail("Not confirmed. Nothing was changed.")
	}

	if kind == "database" {
		return backup.RestoreDB(t.S, file, dir)
	}
	return backup.RestoreMedia(t.S, file, dir)
}

// restoreChoice is a backup Restore offers: on this server, or only in the bucket.
type restoreChoice struct {
	name  string
	size  int64
	where string
}

// restoreChoices lists the newest 20 backups by the time in their names: the ones on this server and, with off-site
// backups on, the ones only the bucket still has. A bucket that doesn't answer leaves the local ones.
func (t *Tool) restoreChoices(dir string) []restoreChoice {
	var choices []restoreChoice
	local := map[string]bool{}
	for _, f := range backup.List(dir) {
		choices = append(choices, restoreChoice{name: f.Name(), size: f.Size})
		local[f.Name()] = true
	}
	if config, _ := offsite.Load(t.P.EnvFile()); config != nil {
		var objects []offsite.Object
		err := ui.Spin("Listing the off-site backups", func(io.Writer) (err error) {
			objects, err = config.List(interrupt.Context())
			return err
		})
		if err != nil {
			ui.Warn("The off-site backups aren't listed: %v.", err)
		}
		for _, o := range objects {
			if !local[o.Name] {
				choices = append(choices, restoreChoice{name: o.Name, size: o.Size, where: ", off-site"})
			}
		}
	}
	slices.SortStableFunc(choices, func(a, b restoreChoice) int {
		return strings.Compare(backup.StampOf(b.name), backup.StampOf(a.name))
	})
	return choices[:min(len(choices), 20)]
}

// restoreFile finds the backup to restore: a path as given, a name in the backups' folder, or a name in the bucket,
// which is downloaded into that folder.
func (t *Tool) restoreFile(file, dir string) (string, error) {
	isFile := func(path string) bool {
		info, err := os.Stat(path)
		return err == nil && info.Mode().IsRegular()
	}
	if isFile(file) {
		return file, nil
	}
	if filepath.Base(file) != file {
		return "", ui.Fail("%s doesn't exist.", file)
	}
	if inDir := filepath.Join(dir, file); isFile(inDir) {
		return inDir, nil
	}
	config, err := offsite.Load(t.P.EnvFile())
	if err != nil || config == nil {
		return "", ui.Fail("%s doesn't exist, here or in %s.", file, dir)
	}
	path := ""
	err = ui.Spin("Downloading "+file, func(io.Writer) (err error) {
		path, err = config.Download(interrupt.Context(), file, dir)
		return err
	})
	if err == interrupt.ErrInterrupted {
		return "", err
	}
	if err != nil {
		return "", ui.Fail("%s isn't in %s, and it didn't come from the bucket: %v.", file, dir, err)
	}
	ui.OK("Downloaded → %s (%s)", path, backup.Size(sizeOf(path)))
	return path, nil
}
