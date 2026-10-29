package commands

import (
	"fmt"
	"os"
	"strings"

	"deploy/internal/backup"
	"deploy/internal/envfile"
	"deploy/internal/project"
	"deploy/internal/ui"
)

// Backup backs up the database, the media, or both. Without a terminal the database is the default; `--dir` is
// remembered in .env, so the next run (and cron) writes to the same place.
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
	if what == "all" || what == "db" {
		if _, err := backup.DB(t.S, dir, stamp, ""); err != nil {
			return err
		}
	}
	if what == "all" || what == "media" {
		if err := backup.Media(t.S, dir, stamp); err != nil {
			return err
		}
	}
	backup.Prune(t.P, dir)
	return nil
}

// Restore restores a db-… or media-… backup. It asks for the domain to be typed, not just y: this replaces live data,
// and the domain proves it's the server you meant.
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
		files := backup.List(dir)
		if len(files) == 0 {
			return ui.Fail("No backups in %s.", dir)
		}
		files = files[:min(len(files), 20)]
		labels := make([]string, len(files))
		for i, f := range files {
			labels[i] = fmt.Sprintf("%s  (%s)", f.Name(), backup.Size(f.Size))
		}
		n, err := ui.Choose("Which backup? (newest first)", labels)
		if err != nil {
			return err
		}
		file = files[n].Path
	}
	info, err := os.Stat(file)
	if err != nil || !info.Mode().IsRegular() {
		return ui.Fail("%s doesn't exist.", file)
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
