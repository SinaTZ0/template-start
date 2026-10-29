package commands

import (
	"deploy/internal/backup"
	"deploy/internal/envfile"
	"deploy/internal/gitrepo"
	"deploy/internal/stack"
	"deploy/internal/status"
	"deploy/internal/ui"
)

/*===== Update =====*/

// Update backs up the database, pulls, and hands over to the pulled tool's Apply.
func (t *Tool) Update(args []string) error {
	if err := noArgs("update", args); err != nil {
		return err
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
	before := gitrepo.ShortHead(t.P.Root)
	if err := gitrepo.Pull(t.P.Root); err != nil {
		return ui.Fail("git pull failed (see above). Nothing was rebuilt.")
	}
	after := gitrepo.ShortHead(t.P.Root)
	if before == after {
		ui.Info("Already on the newest commit (%s); rebuilding anyway, for changes in .env.", after)
	} else {
		_ = gitrepo.Log(t.P.Root, before, after)
	}

	// The pulled binary, not this one: its settings registry knows the variables the new commits added, so they're
	// filled in or asked for before the build. git pull wrote it as a new file; this process still runs the old one.
	if err := runTool(t.P.Root, "apply", "--after-update"); err != nil {
		return err
	}
	ui.OK("Updated to %s", after)
	return nil
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
