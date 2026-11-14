package commands

import (
	"strings"

	"deploy/internal/backup"
	"deploy/internal/ui"
)

/*===== Verify =====*/

// Verify tests that a database backup restores (backup.Verify): the newest one in the backups' folder, or the one
// named, which may be a file, a name in that folder or a name in the off-site bucket. The schedule runs it every
// week, so a backup that can't be restored is found on a quiet Sunday, not on the day it's needed. What it found is
// kept for the Last backup status line.
func (t *Tool) Verify(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	if len(args) > 1 || (len(args) == 1 && strings.HasPrefix(args[0], "-")) {
		return ui.Usage("verify takes one backup at most (see deploy/deploy.sh help)")
	}
	dir := backup.Dir(t.P)
	file := ""
	if len(args) == 1 {
		var err error
		if file, err = t.restoreFile(args[0], dir); err != nil {
			return err
		}
		if !(backup.File{Path: file}).IsDB() {
			return ui.Fail("Only database backups (db-….dump) can be tested; %s isn't one.", file)
		}
	} else {
		for _, f := range backup.List(dir) {
			if f.IsDB() {
				file = f.Path
				break
			}
		}
		if file == "" {
			return ui.Fail("No database backup in %s to test. Make one: deploy/deploy.sh backup --db", dir)
		}
	}

	found, err := backup.Verify(t.S, file)
	if err != nil {
		return err
	}
	name := backup.File{Path: file}.Name()
	backup.MarkVerified(t.P.Root, name)
	age := ""
	if made, ok := backup.MadeAt(name); ok {
		age = ", made " + made.Format("2006-01-02 15:04")
	}
	ui.OK("%s restores: %d %s, %d %s%s. The test database is gone again.", name, found.Tables,
		plural(found.Tables, "table"), found.Rows, plural(int(found.Rows), "row"), age)
	return nil
}
