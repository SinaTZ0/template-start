package commands

import (
	"errors"
	"fmt"

	"deploy/internal/interrupt"
	"deploy/internal/steps"
	"deploy/internal/ui"
)

/*===== Deploy Steps =====*/
// The commands a commit needs on the server (deploy/steps/, docs/deployment.md → Deploy Steps): checked before the
// build, run after every deploy, recorded in the database's ledger. Only the commands below may be steps, each safe to
// run again: a command stopped halfway isn't recorded, so the next run repeats it.

// stepCommands are the commands a step may run, with the check that reads their arguments without running anything.
var stepCommands = map[string]struct {
	check func(args []string) error
	run   func(t *Tool, args []string) error
}{
	"seed": {checkSeed, (*Tool).Seed},
}

// checkStep checks that every command of a step is one the tool can run, with arguments it accepts.
func checkStep(step steps.Step) error {
	if step.Err != nil {
		return ui.Fail("Deploy step %s can't be read: %v.", step.Name, step.Err)
	}
	for _, command := range step.Commands {
		known, ok := stepCommands[command[0]]
		if !ok {
			return ui.Fail("Deploy step %s runs %q, which isn't a command a step may run (only: seed).", step.Name,
				steps.Commandline(command))
		}
		if err := known.check(command[1:]); err != nil {
			return ui.Fail("Deploy step %s runs %q: %v", step.Name, steps.Commandline(command), err)
		}
	}
	return nil
}

// checkPendingSteps runs before the build: a step the new tool can't run stops the deploy while the old app still
// serves. Without a ledger (a new server, or the first deploy that has one) there's nothing to check: the ledger
// starts by marking every step done.
func (t *Tool) checkPendingSteps() error {
	all, err := steps.Load(t.P.Root)
	if err != nil {
		return ui.Fail("Can't read %s: %v", steps.Dir, err)
	}
	ledger, err := steps.Read(t.S)
	if errors.Is(err, interrupt.ErrInterrupted) {
		return err
	}
	if err != nil || !ledger.Started() {
		return nil
	}
	for _, step := range steps.Pending(all, ledger) {
		if err := checkStep(step); err != nil {
			return err
		}
	}
	return nil
}

// afterDeploy runs the pending steps once the new app serves. The first time (a new server, or the first deploy that
// has the ledger) it only starts the ledger, marking every step there is done: a new server's Seed loads the data
// they'd change.
func (t *Tool) afterDeploy() error {
	all, err := steps.Load(t.P.Root)
	if err != nil {
		return ui.Fail("The new version runs, but %s can't be read: %v", steps.Dir, err)
	}
	ledger, err := steps.Read(t.S)
	if errors.Is(err, interrupt.ErrInterrupted) {
		return err
	}
	if err != nil {
		return ui.Fail("The new version runs, but the deploy steps' ledger can't be read (%v). Run deploy/deploy.sh "+
			"steps once the database is up.", err)
	}
	if !ledger.Started() {
		names := make([]string, len(all))
		for i, step := range all {
			names[i] = step.Name
		}
		if err := steps.Baseline(t.S, names); err != nil {
			return interrupt.Check(ui.Fail("The new version runs, but the deploy steps' ledger couldn't be started: %v",
				err))
		}
		ui.Info("Deploy steps: ledger started; %d existing steps marked done without running.", len(names))
		return nil
	}
	return t.runSteps(steps.Pending(all, ledger), ledger, "The new version runs, but deploy step")
}

// runSteps runs steps in order, each from the first command it hasn't finished, and records each command as it
// finishes. It stops at the first failure and says which step and command failed and how much is left. lead starts
// that message.
func (t *Tool) runSteps(pending []steps.Step, ledger steps.Ledger, lead string) error {
	if len(pending) == 0 {
		return nil
	}
	ui.Step("Deploy steps (%d)", len(pending))
	for i, step := range pending {
		// What's left after this step, for the failure message.
		left := pending[i+1:]
		leftCommands := 0
		for _, s := range left {
			leftCommands += len(s.Commands)
		}
		remaining := fmt.Sprintf("%d more steps (%d commands) not run.", len(left), leftCommands)
		if len(left) == 1 {
			remaining = fmt.Sprintf("1 more step (%d commands) not run.", leftCommands)
		}

		if err := checkStep(step); err != nil {
			return ui.Fail("%s %s can't run: %v\n%s", lead, step.Name, err, remaining)
		}
		row, started := ledger.Rows[step.Name]
		start := 0
		if started {
			if row.Commands != len(step.Commands) {
				return ui.Fail("%s %s changed after it started (%d commands then, %d now), so it can't tell where to "+
					"carry on. Run it from the start: deploy/deploy.sh steps --rerun %s\n%s", lead, step.Name,
					row.Commands, len(step.Commands), step.Name, remaining)
			}
			start = row.Done
		} else if err := steps.Progress(t.S, step.Name, len(step.Commands), 0); err != nil {
			// A row from the start, so a step whose first command fails shows as stopped, not as not started.
			return interrupt.Check(ui.Fail("%s %s couldn't be recorded in the ledger: %v\n%s", lead, step.Name, err,
				remaining))
		}
		for j := start; j < len(step.Commands); j++ {
			command := step.Commands[j]
			ui.Info("%s", ui.Bold(fmt.Sprintf("%s  [%d/%d]  %s", step.Name, j+1, len(step.Commands),
				steps.Commandline(command))))
			err := stepCommands[command[0]].run(t, command[1:])
			if err == nil {
				err = steps.Progress(t.S, step.Name, len(step.Commands), j+1)
			}
			if err != nil {
				summary := fmt.Sprintf("%s %s failed at command %d of %d (%s)", lead, step.Name, j+1,
					len(step.Commands), steps.Commandline(command))
				if !errors.Is(err, interrupt.ErrInterrupted) {
					summary += ": " + err.Error()
				}
				summary += "\n" + remaining + " Fix it, then run deploy/deploy.sh steps: it carries on from that command."
				if errors.Is(err, interrupt.ErrInterrupted) {
					ui.Warn("%s", summary)
					return err
				}
				return ui.Fail("%s", summary)
			}
		}
		ui.OK("%s done.", step.Name)
	}
	return nil
}

/*===== The Steps Command =====*/

// Steps lists the deploy steps and runs the pending ones. --list only lists; --rerun <name> runs one again from its
// first command, done or not.
func (t *Tool) Steps(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	list, rerun := false, ""
	switch {
	case len(args) == 0:
	case len(args) == 1 && args[0] == "--list":
		list = true
	case len(args) == 2 && args[0] == "--rerun":
		rerun = args[1]
	default:
		return ui.Usage("steps takes --list or --rerun <name> (see deploy/deploy.sh help)")
	}

	all, err := steps.Load(t.P.Root)
	if err != nil {
		return ui.Fail("Can't read %s: %v", steps.Dir, err)
	}
	ledger, err := steps.Read(t.S)
	if errors.Is(err, interrupt.ErrInterrupted) {
		return err
	}
	if err != nil {
		return ui.Fail("The ledger can't be read (%v). Is the database running? The first update or apply that has "+
			"it makes it.", err)
	}
	if !ledger.Started() {
		return ui.Fail("The ledger isn't started yet: the next update or apply starts it.")
	}

	if rerun != "" {
		for _, step := range all {
			if step.Name != rerun {
				continue
			}
			if err := steps.Forget(t.S, step.Name); err != nil {
				return interrupt.Check(ui.Fail("Couldn't reset %s in the ledger: %v", step.Name, err))
			}
			delete(ledger.Rows, step.Name)
			return t.runSteps([]steps.Step{step}, ledger, "Deploy step")
		}
		return ui.Fail("No step %s in %s.", rerun, steps.Dir)
	}

	ui.Step("Deploy steps")
	if len(all) == 0 {
		ui.Info("None in %s.", steps.Dir)
	}
	for _, step := range all {
		ui.Info("  %s", stepLine(step, ledger))
	}
	pending := steps.Pending(all, ledger)
	if list || len(pending) == 0 {
		return nil
	}
	return t.runSteps(pending, ledger, "Deploy step")
}

// stepLine is a step and where it stands, for the list.
func stepLine(step steps.Step, ledger steps.Ledger) string {
	row, ok := ledger.Rows[step.Name]
	state := ui.Yellow("pending")
	switch {
	case step.Err != nil && (!ok || !row.Finished):
		state = ui.Red("can't be read: " + step.Err.Error())
	case ok && row.Skipped:
		state = ui.Dim("skipped (done before the ledger started)")
	case ok && row.Finished:
		state = ui.Green("done")
	case ok:
		state = ui.Red(fmt.Sprintf("stopped at command %d of %d", row.Done+1, row.Commands))
	}
	return fmt.Sprintf("%-40s %s", step.Name, state)
}
