// Package backup writes and restores the database and media backups: `db-<stamp>[-<why>].dump` (`pg_dump -Fc`,
// compressed, restored with `pg_restore`) and `media-<stamp>.tar.gz` (the image store's volume). Files are written as
// `.part`, readable only by their owner, and renamed once complete, so a half-written backup never looks like one.
package backup

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"deploy/internal/envfile"
	"deploy/internal/interrupt"
	"deploy/internal/project"
	"deploy/internal/stack"
	"deploy/internal/ui"
)

const stampLayout = "20060102-150405"

// Stamp is the time part of a backup's name.
func Stamp() string { return time.Now().Format(stampLayout) }

// StampOf is the time part of a backup's name (`db-20261114-030000-pre-update.dump` → `20261114-030000`), which
// sorts as text. Anything else comes back as it is.
func StampOf(name string) string {
	rest := strings.TrimPrefix(strings.TrimPrefix(name, "db-"), "media-")
	if len(rest) >= len(stampLayout) {
		return rest[:len(stampLayout)]
	}
	return name
}

// MadeAt is when a backup was made, by its name; false when the name doesn't say.
func MadeAt(name string) (time.Time, bool) {
	when, err := time.ParseInLocation(stampLayout, StampOf(name), time.Local)
	return when, err == nil
}

// Dir is BACKUP_DIR as an absolute path; a relative one is relative to the project folder.
func Dir(p *project.Project) string {
	dir := envfile.Get(p.EnvFile(), "BACKUP_DIR")
	if dir == "" {
		dir = "./backups"
	}
	if !filepath.IsAbs(dir) {
		dir = filepath.Join(p.Root, strings.TrimPrefix(dir, "./"))
	}
	return filepath.Clean(dir)
}

// File is a backup on disk.
type File struct {
	Path     string
	Modified time.Time
	Size     int64
}

// Name is the file's name without its folder.
func (f File) Name() string { return filepath.Base(f.Path) }

// IsDB reports whether it's a database dump.
func (f File) IsDB() bool {
	return strings.HasPrefix(f.Name(), "db-") && strings.HasSuffix(f.Name(), ".dump")
}

// IsMedia reports whether it's a media archive.
func (f File) IsMedia() bool {
	return strings.HasPrefix(f.Name(), "media-") && strings.HasSuffix(f.Name(), ".tar.gz")
}

// List lists the backups in dir, newest first.
func List(dir string) []File {
	entries, _ := os.ReadDir(dir)
	var files []File
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		f := File{Path: filepath.Join(dir, e.Name()), Modified: info.ModTime(), Size: info.Size()}
		if f.IsDB() || f.IsMedia() {
			files = append(files, f)
		}
	}
	slices.SortFunc(files, func(a, b File) int { return b.Modified.Compare(a.Modified) })
	return files
}

// Size formats a byte count the way `du -h` does.
func Size(n int64) string {
	units := []string{"", "K", "M", "G", "T"}
	value := float64(n)
	i := 0
	for value >= 1024 && i < len(units)-1 {
		value /= 1024
		i++
	}
	if i == 0 {
		return strconv.FormatInt(n, 10)
	}
	if value < 10 {
		return fmt.Sprintf("%.1f%s", value, units[i])
	}
	return fmt.Sprintf("%.0f%s", value, units[i])
}

// DirSize is the total size of the files in dir.
func DirSize(dir string) int64 {
	var total int64
	_ = filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if info, err := d.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total
}

// writeTo streams fn's output into path, through path.part, readable only by its owner.
func writeTo(path string, fn func(w io.Writer) error) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	part := path + ".part"
	f, err := os.OpenFile(part, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	err = fn(f)
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(part)
		return err
	}
	return os.Rename(part, path)
}

func sizeOf(path string) string {
	info, err := os.Stat(path)
	if err != nil {
		return "?"
	}
	return Size(info.Size())
}

/*===== Database =====*/

// DB dumps the database into dir as db-<stamp><suffix>.dump and returns its path.
func DB(s *stack.Stack, dir, stamp, suffix string) (string, error) {
	path := filepath.Join(dir, "db-"+stamp+suffix+".dump")
	if s.State("db") != "healthy" {
		return "", ui.Fail("The database isn't running, so it can't be backed up.")
	}
	err := writeTo(path, func(w io.Writer) error {
		return ui.Spin("Dumping the database", func(stderr io.Writer) error {
			cmd := s.Command(nil, "exec", "-T", "db", "pg_dump", "-U", "app", "-Fc", "app")
			cmd.Stdout, cmd.Stderr = w, stderr
			return cmd.Run()
		})
	})
	if err != nil {
		if err == interrupt.ErrInterrupted {
			return "", err
		}
		return "", ui.Fail("pg_dump failed (see above).")
	}
	ui.OK("Database → %s (%s)", path, sizeOf(path))
	return path, nil
}

// The dump loads into restoreDB, which then takes the live database's name; replacedDB is the live one on its way out.
const (
	liveDB     = "app"
	restoreDB  = "app_restore"
	replacedDB = "app_replaced"
	// verifyDB is where Verify loads a dump to see that it restores; dropped again right after.
	verifyDB = "app_verify"
)

// RestoreDB replaces the database with a dump. A dump of the current one is taken first, and the app is stopped while
// the dump loads, so nothing writes in between.
//
// The dump loads into a new, empty database that then takes the live one's name. Loading it over the live database
// (`pg_restore --clean`) only drops what the dump itself holds: a table a later migration added would stay, next to a
// migration history that says it was never made, and the next deploy would fail on "already exists". A restore that
// fails leaves the live database untouched.
func RestoreDB(s *stack.Stack, file, dir string) error {
	ui.Step("Backing up the current database first")
	if _, err := DB(s, dir, Stamp(), "-pre-restore"); err != nil {
		return err
	}
	ui.Step("Stopping the app")
	if err := s.Run("stop", "app"); err != nil {
		return err
	}
	in, err := os.Open(file)
	if err != nil {
		return err
	}
	defer in.Close()
	restoreErr := ui.Spin("Restoring "+filepath.Base(file), func(stderr io.Writer) error {
		// Left behind only by a restore that was killed part-way.
		if err := psql(s, stderr, dropDB(restoreDB), dropDB(replacedDB), "CREATE DATABASE "+restoreDB); err != nil {
			return err
		}
		cmd := s.Command(nil, "exec", "-T", "db", "pg_restore", "-U", "app", "-d", restoreDB, "--no-owner",
			"--single-transaction")
		cmd.Stdin, cmd.Stdout, cmd.Stderr = in, stderr, stderr
		if err := cmd.Run(); err != nil {
			return err
		}
		// A database can't be renamed while anyone is connected to it (the database browser, a forgotten psql). One
		// statement list is one transaction: both names change, or neither.
		return psql(s, stderr,
			"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '"+liveDB+"' AND pid <> pg_backend_pid(); "+
				"ALTER DATABASE "+liveDB+" RENAME TO "+replacedDB+"; "+
				"ALTER DATABASE "+restoreDB+" RENAME TO "+liveDB)
	})
	// Cleaned up and started again even after Ctrl-C: a stopped app is worse than a restore given up on.
	interrupt.Reset()
	_ = psql(s, io.Discard, dropDB(restoreDB), dropDB(replacedDB))
	ui.Step("Starting the app")
	if err := s.Run("start", "app"); err != nil {
		return err
	}
	if restoreErr != nil {
		return ui.Fail("The restore failed (see above): the database is as it was, and the app is running.")
	}
	if err := ui.Spin("Waiting for the app to turn healthy", func(io.Writer) error {
		return s.WaitHealthy("app", 180*time.Second)
	}); err != nil {
		ui.Warn("The app didn't turn healthy. Its logs: deploy/deploy.sh logs app")
	}
	ui.OK("Database restored from %s", filepath.Base(file))
	return nil
}

func dropDB(name string) string { return "DROP DATABASE IF EXISTS " + name + " WITH (FORCE)" }

// psql runs statements against the server's `postgres` database, since the ones here create, rename and drop the
// app's own. Each statement is its own transaction (`DROP DATABASE` refuses to run inside one), and the first that
// fails stops the rest.
func psql(s *stack.Stack, stderr io.Writer, statements ...string) error {
	// Without the notices ("database does not exist, skipping"), which would read as something having gone wrong.
	args := []string{"exec", "-T", "-e", "PGOPTIONS=--client-min-messages=warning", "db", "psql", "-U", "app", "-d",
		"postgres", "-q", "-v", "ON_ERROR_STOP=1"}
	for _, statement := range statements {
		args = append(args, "-c", statement)
	}
	cmd := s.Command(nil, args...)
	cmd.Stdout, cmd.Stderr = io.Discard, stderr
	return cmd.Run()
}

// query runs one statement against a database and returns what it printed: one line per row, columns separated by
// `|`.
func query(s *stack.Stack, stderr io.Writer, database, statement string) (string, error) {
	cmd := s.Command(nil, "exec", "-T", "db", "psql", "-U", "app", "-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c",
		statement)
	var out strings.Builder
	cmd.Stdout, cmd.Stderr = &out, stderr
	err := cmd.Run()
	return strings.TrimSpace(out.String()), err
}

/*===== Verify =====*/

// Verified is what a dump held when it was restored as a test.
type Verified struct {
	Tables int
	Rows   int64
}

// Verify proves that a dump restores: it loads it into a database of its own next to the live one, counts the tables
// and rows that arrived, and drops it again. The live database and the app aren't touched. A dump that doesn't load,
// or loads without a single table, is an error: that's the backup that would have failed on the day it was needed.
func Verify(s *stack.Stack, file string) (Verified, error) {
	var found Verified
	if s.State("db") != "healthy" {
		return found, ui.Fail("The database isn't running, so there's nowhere to test the backup.")
	}
	in, err := os.Open(file)
	if err != nil {
		return found, err
	}
	defer in.Close()
	err = ui.Spin("Restoring "+filepath.Base(file)+" into a test database", func(stderr io.Writer) error {
		// Left behind only by a test that was killed part-way.
		if err := psql(s, stderr, dropDB(verifyDB), "CREATE DATABASE "+verifyDB); err != nil {
			return err
		}
		cmd := s.Command(nil, "exec", "-T", "db", "pg_restore", "-U", "app", "-d", verifyDB, "--no-owner",
			"--single-transaction")
		cmd.Stdin, cmd.Stdout, cmd.Stderr = in, stderr, stderr
		if err := cmd.Run(); err != nil {
			return err
		}
		// The names come back quoted by Postgres, ready to be counted: the planner's row estimates are all zero in a
		// database that was never analysed, so each table is counted for real.
		tables, err := query(s, stderr, verifyDB, "SELECT format('%I.%I', schemaname, tablename) FROM pg_tables "+
			"WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")
		if err != nil || tables == "" {
			return err
		}
		names := strings.Split(tables, "\n")
		counts := make([]string, len(names))
		for i, name := range names {
			counts[i] = "(SELECT count(*) FROM " + name + ")"
		}
		rows, err := query(s, stderr, verifyDB, "SELECT "+strings.Join(counts, " + "))
		if err != nil {
			return err
		}
		found.Tables = len(names)
		found.Rows, err = strconv.ParseInt(rows, 10, 64)
		return err
	})
	// Dropped even after Ctrl-C: a forgotten copy of the database takes its size in disk space.
	interrupt.Reset()
	_ = psql(s, io.Discard, dropDB(verifyDB))
	if err == interrupt.ErrInterrupted {
		return found, err
	}
	if err != nil {
		return found, ui.Fail("%s doesn't restore (see above). The live database wasn't touched.", filepath.Base(file))
	}
	if found.Tables == 0 {
		return found, ui.Fail("%s restores, but it holds no tables. The live database wasn't touched.",
			filepath.Base(file))
	}
	return found, nil
}

// verifiedFile is where a checkout keeps when a backup last restored as a test, and which one.
func verifiedFile(root string) string { return filepath.Join(root, "deploy", "logs", "verify.state") }

// MarkVerified records that the backup called name just restored as a test.
func MarkVerified(root, name string) {
	_ = os.MkdirAll(filepath.Dir(verifiedFile(root)), 0o755)
	_ = os.WriteFile(verifiedFile(root), []byte(time.Now().UTC().Format(time.RFC3339)+" "+name+"\n"), 0o600)
}

// LastVerified is when a backup last restored as a test; the zero time when none did.
func LastVerified(root string) time.Time {
	content, _ := os.ReadFile(verifiedFile(root))
	when, _ := time.Parse(time.RFC3339, strings.SplitN(strings.TrimSpace(string(content)), " ", 2)[0])
	return when
}

/*===== Media =====*/

// Media copies the image store's volume into dir as media-<stamp>.tar.gz. The store is stopped while it's copied, so
// the copy is consistent: images don't load for that time. The archive streams to this side, so it belongs to this
// user, not root. It returns the archive's path.
func Media(s *stack.Stack, dir, stamp string) (string, error) {
	id := s.ContainerID("seaweedfs")
	if id == "" {
		return "", ui.Fail("There's no image store container to back up.")
	}
	path := filepath.Join(dir, "media-"+stamp+".tar.gz")
	ui.Step("Stopping the image store (images don't load until it's back)")
	if err := s.Run("stop", "seaweedfs"); err != nil {
		return "", err
	}
	copyErr := writeTo(path, func(w io.Writer) error {
		return ui.Spin("Copying the media", func(stderr io.Writer) error {
			cmd := stack.Docker(nil, "run", "--rm", "--volumes-from", id, stack.HelperImage, "tar", "czf", "-", "-C", "/data", ".")
			cmd.Stdout, cmd.Stderr = w, stderr
			return cmd.Run()
		})
	})
	interrupt.Reset()
	if err := s.Run("start", "seaweedfs"); err != nil {
		return "", err
	}
	if copyErr != nil {
		return "", ui.Fail("Copying the media failed (see above). The image store is running again.")
	}
	ui.OK("Media → %s (%s)", path, sizeOf(path))
	return path, nil
}

// RestoreMedia replaces the image store's volume with an archive, after offering a backup of the current one.
func RestoreMedia(s *stack.Stack, file, dir string) error {
	id := s.ContainerID("seaweedfs")
	if id == "" {
		return ui.Fail("There's no image store container to restore into.")
	}
	ok, err := ui.Confirm("Back up the current media first?", true)
	if err != nil {
		return err
	}
	if ok {
		if _, err := Media(s, dir, Stamp()+"-pre-restore"); err != nil {
			return err
		}
	}
	ui.Step("Stopping the image store")
	if err := s.Run("stop", "seaweedfs"); err != nil {
		return err
	}
	in, err := os.Open(file)
	if err != nil {
		return err
	}
	defer in.Close()
	restoreErr := ui.Spin("Restoring "+filepath.Base(file), func(stderr io.Writer) error {
		cmd := stack.Docker(nil, "run", "--rm", "-i", "--volumes-from", id, stack.HelperImage, "sh", "-c",
			"find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf - -C /data")
		cmd.Stdin, cmd.Stdout, cmd.Stderr = in, stderr, stderr
		return cmd.Run()
	})
	interrupt.Reset()
	if err := s.Run("start", "seaweedfs"); err != nil {
		return err
	}
	if restoreErr != nil {
		return ui.Fail("The restore failed part-way, so the media may be incomplete. Restore a backup again.")
	}
	ui.OK("Media restored from %s", filepath.Base(file))
	return nil
}

/*===== Pruning =====*/

// Prune keeps the newest BACKUP_KEEP (14 by default) of each kind.
func Prune(p *project.Project, dir string) {
	keep, err := strconv.Atoi(envfile.Get(p.EnvFile(), "BACKUP_KEEP"))
	if err != nil || keep < 1 {
		keep = 14
	}
	var dbs, media []File
	for _, f := range List(dir) {
		if f.IsDB() {
			dbs = append(dbs, f)
		} else {
			media = append(media, f)
		}
	}
	for _, kind := range [][]File{dbs, media} {
		if len(kind) > keep {
			for _, f := range kind[keep:] {
				os.Remove(f.Path)
			}
		}
	}
}
