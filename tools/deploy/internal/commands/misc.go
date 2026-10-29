package commands

import (
	"fmt"
	"os/exec"
	"slices"
	"strings"
	"time"

	"deploy/internal/backup"
	"deploy/internal/interrupt"
	"deploy/internal/pgweb"
	"deploy/internal/stack"
	"deploy/internal/status"
	"deploy/internal/ui"
)

/*===== Status =====*/

// Status shows the containers, disk, Docker's disk use, the backups and the status lines.
func (t *Tool) Status(args []string) error {
	if err := noArgs("status", args); err != nil {
		return err
	}
	if err := t.requireSetUp(); err != nil {
		return err
	}
	ui.Step("Containers")
	_ = t.S.Run("ps", "-a", "--format", "table {{.Service}}\t{{.State}}\t{{.Status}}")
	ui.Step("Disk")
	df := exec.Command("df", "-h", t.P.Root)
	df.Stdout, df.Stderr = ui.Out, ui.Err
	_ = df.Run()
	system := stack.Docker(nil, "system", "df")
	system.Stdout, system.Stderr = ui.Out, ui.Err
	_ = system.Run()
	ui.Step("Backups")
	dir := backup.Dir(t.P)
	ui.Info("%s: %d files, %s", dir, len(backup.List(dir)), backup.Size(backup.DirSize(dir)))
	ui.Step("Status")
	for _, line := range status.Lines(t.P, t.S, t.Env) {
		ui.Info("  %s", line)
	}
	return nil
}

/*===== Logs =====*/

// Logs follows a service's last 200 log lines until Ctrl-C.
func (t *Tool) Logs(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	if len(args) > 1 {
		return ui.Usage("logs takes one service (see deploy/deploy.sh help)")
	}
	service := ""
	if len(args) == 1 {
		service = args[0]
	} else {
		n, err := ui.Choose("Which service?", stack.Services)
		if err != nil {
			return err
		}
		service = stack.Services[n]
	}
	if !slices.Contains(stack.Services, service) {
		return ui.Fail("No service %q: one of %s.", service, join(stack.Services))
	}
	ui.Info("%s", ui.Dim(fmt.Sprintf("Following %s; Ctrl-C to stop.", service)))
	_ = t.S.Run("logs", "-f", "--tail", "200", service)
	return interrupt.Check(nil)
}

/*===== Make Admin =====*/

// Admin gives an account the admin role.
func (t *Tool) Admin(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	if len(args) > 1 {
		return ui.Usage("admin takes one email (see deploy/deploy.sh help)")
	}
	email := ""
	if len(args) == 1 {
		email = args[0]
	} else {
		var err error
		if email, err = ui.Ask("Email of the account", "", "the email"); err != nil {
			return err
		}
	}
	if !strings.Contains(email, "@") {
		return ui.Fail("%q isn't an email address.", email)
	}
	// The email goes in as a psql variable (`:'email'` quotes it), never pasted into the SQL.
	cmd := t.S.Command(nil, "exec", "-T", "db", "psql", "-U", "app", "-d", "app", "-v", "ON_ERROR_STOP=1",
		"-v", "email="+email, "-qtA")
	cmd.Stdin = strings.NewReader(`update "user" set role = 'admin' where email = :'email' returning email;`)
	cmd.Stderr = ui.Err
	out, err := cmd.Output()
	if err != nil {
		return interrupt.Check(ui.Fail("psql failed (see above)."))
	}
	if strings.TrimSpace(string(out)) == "" {
		return ui.Fail("No account with %s. Sign up on the site first.", email)
	}
	ui.OK("%s is now an admin.", email)
	return nil
}

/*===== Seed =====*/

// Seed loads a server's content from the seeds bundled into the app's image (the Dockerfile's esbuild step). The
// template has one part, `notes`, the note feature's sample notes; a project replaces it with its own parts, each
// taking its own options after its name, and keeps every part safe to run twice (deploy steps rerun a stopped
// command). Without a part, on a terminal, it asks which.
func (t *Tool) Seed(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	if len(args) == 0 {
		if !ui.Interactive {
			return ui.Usage("seed needs a part: notes (see deploy/deploy.sh help)")
		}
		return t.seedMenu()
	}
	if err := checkSeed(args); err != nil {
		return err
	}
	switch part, rest := args[0], args[1:]; part {
	case "notes":
		return t.seedNotes(rest)
	}
	return nil
}

// checkSeed checks a seed command line without running anything. Deploy steps are checked with it before the build,
// so a step the new tool can't run stops the update while the old app still serves.
func checkSeed(args []string) error {
	if len(args) == 0 {
		return ui.Usage("seed needs a part: notes (see deploy/deploy.sh help)")
	}
	switch part, rest := args[0], args[1:]; part {
	case "notes":
		for i := 0; i < len(rest); i++ {
			switch rest[i] {
			case "--replace":
			case "--owner":
				if i+1 >= len(rest) || !strings.Contains(rest[i+1], "@") {
					return ui.Usage("--owner needs an email (see deploy/deploy.sh help)")
				}
				i++
			default:
				return ui.Usage("seed notes doesn't know %s (see deploy/deploy.sh help)", rest[i])
			}
		}
	default:
		return ui.Usage("Unknown seed part: %s (notes)", part)
	}
	return nil
}

func (t *Tool) seedMenu() error {
	n, err := ui.Choose("Seed what?", []string{
		"Notes           sample notes for the first admin",
		"Back",
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return t.seedNotes(nil)
	}
	return nil
}

/*------ Notes ------*/

// seedNotes gives the first admin (or --owner <email>) the sample notes (`src/db/seed-notes.ts`). An owner who has
// them is skipped; --replace deletes the sample notes and loads them again, leaving the owner's own notes.
func (t *Tool) seedNotes(args []string) error {
	// A one-off container of the running app's service: its image, settings and networks (database, storage).
	run := append([]string{"run", "--rm", "--no-deps", "-T", "app", "node", "deploy/seed-notes.mjs"}, args...)
	if err := t.S.Run(run...); err != nil {
		return interrupt.Check(ui.Fail("Loading the sample notes failed (see above)."))
	}
	ui.OK("Sample notes loaded.")
	return nil
}

/*===== Database Browser =====*/

// Pgweb opens, closes or reports on the database browser. Without a subcommand, on a terminal, it offers what fits:
// closing an open one, or opening one for 1, 4 or 24 hours.
func (t *Tool) Pgweb(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	if len(args) == 0 {
		if !ui.Interactive {
			pgweb.Status(t.S)
			return nil
		}
		return t.pgwebMenu()
	}
	switch sub, rest := args[0], args[1:]; sub {
	case "open":
		d, dump := pgweb.Max, true
		for i := 0; i < len(rest); i++ {
			switch rest[i] {
			case "--for":
				if i+1 >= len(rest) {
					return ui.Usage("--for needs a time, like 30m, 4h or 24h.")
				}
				i++
				var err error
				if d, err = pgweb.ParseDuration(rest[i]); err != nil {
					return ui.Usage("%s", err.Error())
				}
			case "--no-backup":
				dump = false
			default:
				return ui.Usage("Unknown pgweb open option: %s (see deploy/deploy.sh help)", rest[i])
			}
		}
		if err := stack.RequireTools(); err != nil {
			return err
		}
		return pgweb.Open(t.P, t.S, d, dump)
	case "close":
		if err := noArgs("pgweb close", rest); err != nil {
			return err
		}
		return pgweb.Close(t.S)
	case "status":
		if err := noArgs("pgweb status", rest); err != nil {
			return err
		}
		pgweb.Status(t.S)
		return nil
	default:
		return ui.Usage("Unknown pgweb command: %s (open, close or status)", sub)
	}
}

func (t *Tool) pgwebMenu() error {
	if b := pgweb.Find(t.S); b != nil && !b.Overdue() {
		pgweb.Status(t.S)
		n, err := ui.Choose("Database browser:", []string{"Close it now", "Open a new one (a new sign-in)", "Back"})
		if err != nil || n == 2 {
			return err
		}
		if n == 0 {
			return pgweb.Close(t.S)
		}
	}
	ui.Info("A database browser with full read and write access, through an SSH tunnel. It closes itself on time.")
	hours := []time.Duration{time.Hour, 4 * time.Hour, 24 * time.Hour}
	n, err := ui.Choose("Open it for how long?", []string{"1 hour", "4 hours", "24 hours"})
	if err != nil {
		return err
	}
	return pgweb.Open(t.P, t.S, hours[n], true)
}
