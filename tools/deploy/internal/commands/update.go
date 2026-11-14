package commands

import (
	"fmt"
	"io"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"deploy/internal/backup"
	"deploy/internal/envfile"
	"deploy/internal/gitrepo"
	"deploy/internal/interrupt"
	"deploy/internal/stack"
	"deploy/internal/status"
	"deploy/internal/steps"
	"deploy/internal/ui"
)

/*===== Update =====*/

// Update shows what's coming, backs up the database, pulls, and hands over to the pulled tool's Apply. On a terminal
// it asks before changing anything; `--yes` skips the question, and without a terminal there's none.
func (t *Tool) Update(args []string) error {
	yes := false
	for _, arg := range args {
		if arg != "--yes" && arg != "-y" {
			return ui.Usage("Unknown update option: %s (see deploy/deploy.sh help)", arg)
		}
		yes = true
	}
	if err := stack.RequireTools(); err != nil {
		return err
	}
	if err := t.requireSetUp(); err != nil {
		return err
	}
	if changes := gitrepo.TrackedChanges(t.P.Root); changes != "" {
		return ui.Fail("Files were changed on this server, so git pull could clash with them:\n%s\nKeep them with git "+
			"stash, or drop them with git checkout -- <file>, then update again.", changes)
	}

	/*------ What's coming ------*/
	if err := t.showIncoming(); err != nil {
		return err
	}
	if err := t.checkSpace(); err != nil {
		return err
	}
	if ui.Interactive && !yes {
		ok, err := ui.Confirm("Update now?", true)
		if err != nil {
			return err
		}
		if !ok {
			return ui.Fail("Nothing was changed.")
		}
	}

	/*------ Back up, pull, apply ------*/
	// A migration can't be undone by going back a commit; this dump can.
	if t.S.State("db") == "healthy" {
		ui.Step("Backing up the database first")
		dir := backup.Dir(t.P)
		if _, err := backup.DB(t.S, dir, backup.Stamp(), "-pre-update"); err != nil {
			return err
		}
		backup.Prune(t.P, dir)
	} else {
		ui.Warn("The database isn't running, so there's no backup before this update.")
	}

	ui.Step("Pulling")
	if err := gitrepo.Pull(t.P.Root); err != nil {
		return ui.Fail("git pull failed (see above). Nothing was rebuilt.")
	}
	after := gitrepo.ShortHead(t.P.Root)

	// The pulled binary, not this one: its settings registry knows the variables the new commits added, so they're
	// filled in or asked for before the build. git pull wrote it as a new file; this process still runs the old one.
	if err := runTool(t.P.Root, "apply", "--after-update"); err != nil {
		return err
	}
	ui.OK("Updated to %s", after)
	return nil
}

// incomingShown is how many of the incoming commits Update lists; the rest are counted.
const incomingShown = 15

// showIncoming fetches and says what an update would bring: the commits, whether they change the database, and the
// deploy steps that would run after the build. Nothing is changed yet, so the answer to "Update now?" is an informed
// one. A remote that can't be read stops the update here, before the backup.
func (t *Tool) showIncoming() error {
	root := t.P.Root
	if !gitrepo.HasUpstream(root) {
		return ui.Fail("The checked-out branch follows no remote branch, so there's nothing to pull from.")
	}
	var fetchErr error
	if err := ui.Spin("Looking for new commits", func(io.Writer) error {
		fetchErr = gitrepo.Fetch(root, 60*time.Second)
		return nil
	}); err != nil {
		return err
	}
	switch {
	case gitrepo.Refused(fetchErr):
		advice := "Give this server access to it again, then update again."
		if public := deployKeyPublic(root); public != "" {
			advice = "Its deploy key for this server was probably removed. Add this line to the repository again, as a " +
				"deploy key without write access, then update again:\n  " + public
		}
		return ui.Fail("The repository refused this server:\n%s\n%s\nNothing was changed.",
			ui.Indent(fetchErr.Error(), "  "), advice)
	case fetchErr != nil:
		return ui.Fail("Couldn't reach the repository:\n%s\nNothing was changed.", ui.Indent(fetchErr.Error(), "  "))
	}

	/*------ Commits ------*/
	commits := gitrepo.Incoming(root)
	if len(commits) == 0 {
		ui.Info("Already on the newest commit (%s): an update only rebuilds, for changes in .env.",
			gitrepo.ShortHead(root))
	} else {
		ui.Step("%d new %s", len(commits), plural(len(commits), "commit"))
		for _, commit := range commits[:min(len(commits), incomingShown)] {
			ui.Info("  %s", commit)
		}
		if more := len(commits) - incomingShown; more > 0 {
			ui.Info("  %s", ui.Dim(fmt.Sprintf("… and %d older", more)))
		}
		if migrations := gitrepo.IncomingFiles(root, true, "drizzle"); len(migrations) > 0 {
			ui.Warn("They change the database (%d %s). Rolling back the app doesn't undo that; the dump taken "+
				"before the update does.", len(migrations), plural(len(migrations), "migration"))
		}
	}

	/*------ Deploy steps ------*/
	// The ones this server still owes, and the ones the new commits add. Before the ledger exists (the first deploy
	// that has it) every step is marked done without running, so there's nothing to announce.
	var names []string
	if ledger, err := steps.Read(t.S); err == nil && ledger.Started() {
		if all, err := steps.Load(root); err == nil {
			for _, step := range steps.Pending(all, ledger) {
				names = append(names, step.Name)
			}
		}
		for _, file := range gitrepo.IncomingFiles(root, true, steps.Dir) {
			if name := strings.TrimSuffix(filepath.Base(file), ".md"); steps.IsName(name) && !slices.Contains(names, name) {
				names = append(names, name)
			}
		}
	}
	if len(names) > 0 {
		ui.Info("Deploy steps that run after the build:")
		for _, name := range names {
			ui.Info("  %s", name)
		}
		ui.Info("  %s", ui.Dim("What each does is in "+steps.Dir+"/<name>.md, once pulled."))
	}
	return nil
}

/*===== Disk Space =====*/

// buildNeeds is the free space an update is known to fit in: the app's image is built next to the one that runs, with
// its dependencies downloaded again when the lockfile changed.
const buildNeeds = 2 << 30

// checkSpace stops an update that would run out of disk halfway through the build or the dump before it, while the
// fix is still a matter of cleaning up. On a terminal it offers to clear Docker's leftovers, and lets the update go
// ahead anyway.
func (t *Tool) checkSpace() error {
	short := t.shortOfSpace()
	if short == "" {
		return nil
	}
	ui.Warn("%s", short)
	ui.Info("What can go:")
	for _, line := range dockerReclaimable() {
		ui.Info("  %s", line)
	}
	dir := backup.Dir(t.P)
	ui.Info("  %-22s %s in %s (BACKUP_KEEP in .env sets how many are kept)", "Backups", backup.Size(backup.DirSize(dir)), dir)
	const clean = "docker builder prune -f && docker image prune -f"
	if !ui.Interactive {
		return ui.Fail("Not updated. Free space (for Docker's leftovers: %s), then update again.", clean)
	}
	ok, err := ui.Confirm("Clear Docker's build cache and unused images now? (the next build takes longer)", true)
	if err != nil {
		return err
	}
	if ok {
		if err := ui.Spin("Clearing", func(stderr io.Writer) error {
			for _, args := range [][]string{{"builder", "prune", "-f"}, {"image", "prune", "-f"}} {
				cmd := stack.Docker(nil, args...)
				cmd.Stdout, cmd.Stderr = io.Discard, stderr
				if err := cmd.Run(); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return interrupt.Check(ui.Fail("Clearing failed (see above)."))
		}
		if short = t.shortOfSpace(); short == "" {
			ui.OK("Enough space now.")
			return nil
		}
		ui.Warn("%s", short)
	}
	ok, err = ui.Confirm("Go on with too little space? (a build that runs out stops; the running app stays)", false)
	if err != nil {
		return err
	}
	if !ok {
		return ui.Fail("Not updated. Nothing was changed.")
	}
	return nil
}

// shortOfSpace says which disk has too little room for an update, empty when both have enough: Docker's for the
// build, the backups' for the dump taken first (twice the newest one, since the database only grows).
func (t *Tool) shortOfSpace() string {
	if free, ok := status.Free(status.DockerDir); ok && free < buildNeeds {
		return fmt.Sprintf("Little disk space for the build: %s free on %s, and a build can need %s.",
			backup.Size(free), status.DockerDir, backup.Size(buildNeeds))
	}
	dir := backup.Dir(t.P)
	for _, f := range backup.List(dir) {
		if !f.IsDB() {
			continue
		}
		if free, ok := status.Free(dir); ok && free < 2*f.Size {
			return fmt.Sprintf("Little disk space for the database dump: %s free on %s, and the newest dump is %s.",
				backup.Size(free), dir, backup.Size(f.Size))
		}
		break
	}
	return ""
}

// dockerReclaimable lists what Docker says it could give back, per kind (`docker system df`).
func dockerReclaimable() []string {
	out, err := stack.DockerOutput("system", "df", "--format", "{{.Type}}\t{{.Reclaimable}}")
	if err != nil {
		return nil
	}
	var lines []string
	for _, line := range strings.Split(out, "\n") {
		kind, reclaimable, ok := strings.Cut(line, "\t")
		// Volumes hold the database and the media: not something to clear for space.
		if !ok || kind == "Local Volumes" || kind == "Containers" {
			continue
		}
		lines = append(lines, fmt.Sprintf("%-22s %s", "Docker "+strings.ToLower(kind), reclaimable))
	}
	return lines
}

/*===== Apply =====*/

// Apply checks .env and the pending deploy steps, rebuilds and restarts the stack with it, then runs those steps. `--after-update` is how Update hands over to the
// pulled tool; it only changes what a stop says.
func (t *Tool) Apply(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	note := ""
	for _, arg := range args {
		if arg != "--after-update" {
			return ui.Usage("Unknown apply option: %s (see deploy/deploy.sh help)", arg)
		}
		note = "The update stopped before the build: the new code is pulled, but the app that was running still runs " +
			"the old one."
	}
	if err := stack.RequireTools(); err != nil {
		return err
	}
	ui.Step("Checking .env")
	if err := t.Env.Check(note); err != nil {
		return err
	}
	if err := t.checkSources(note); err != nil {
		return err
	}
	if err := t.checkPendingSteps(); err != nil {
		return err
	}
	if err := t.S.Deploy(t.Env); err != nil {
		return err
	}
	ui.OK("The stack runs with the current .env.")
	return t.afterDeploy()
}

/*===== Settings =====*/

// Settings checks .env, then offers to edit and apply it. `--check` only reports, for cron and CI.
func (t *Tool) Settings(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	switch {
	case len(args) == 1 && args[0] == "--check":
		if err := t.Env.CheckOnly(); err != nil {
			return err
		}
		ui.Info("  %s", status.Settings(t.P, t.Env))
		return nil
	case len(args) > 0:
		return ui.Usage("Unknown env option: %s (see deploy/deploy.sh help)", args[0])
	}
	if !ui.Interactive {
		return ui.Fail("No terminal for Settings. deploy/deploy.sh env --check checks .env without asking; " +
			"deploy/deploy.sh apply deploys it.")
	}

	ui.Step("Checking .env")
	if err := t.Env.Check(""); err != nil {
		return err
	}
	for {
		ui.Info("")
		ui.Info("  %s", status.Settings(t.P, t.Env))
		n, err := ui.Choose("Settings:", []string{
			"Edit .env in your editor", "Apply pending changes (rebuild and restart)", "Back",
		})
		if err != nil {
			return err
		}
		switch n {
		case 0:
			edited, err := t.Env.Edit()
			if err != nil {
				return err
			}
			if !edited {
				continue
			}
			if err := t.Env.Check(""); err != nil {
				return err
			}
			apply, err := ui.Confirm("Apply now?", true)
			if err != nil {
				return err
			}
			if apply {
				if err := t.Apply(nil); err != nil {
					return err
				}
			}
		case 1:
			if t.Env.State() == envfile.Applied {
				ui.Info("Nothing pending: the stack already runs with this .env.")
				again, err := ui.Confirm("Rebuild and restart anyway?", false)
				if err != nil {
					return err
				}
				if !again {
					continue
				}
			}
			if err := t.Apply(nil); err != nil {
				return err
			}
		default:
			return nil
		}
	}
}
