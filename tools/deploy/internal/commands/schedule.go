package commands

import (
	"os"
	"strings"

	"deploy/internal/backup"
	"deploy/internal/envfile"
	"deploy/internal/notify"
	"deploy/internal/runlog"
	"deploy/internal/schedule"
	"deploy/internal/status"
	"deploy/internal/ui"
)

/*===== Schedule =====*/

// Schedule turns the tool's cron jobs on or off (package schedule): the nightly database backup, the weekly media
// backup and the hourly check. Without an argument it shows what's scheduled and, on a terminal, offers to change it.
func (t *Tool) Schedule(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	if len(args) > 1 {
		return ui.Usage("schedule takes on or off (see deploy/deploy.sh help)")
	}
	if !schedule.Available() {
		return ui.Fail("cron isn't installed (no `crontab` command). Install it (the cron or cronie package), then run " +
			"this again.")
	}
	crontab, err := schedule.Read()
	if err != nil {
		return err
	}
	on := schedule.On(crontab, t.P.Root)
	if len(args) == 1 {
		switch args[0] {
		case "on":
			return t.scheduleOn(crontab)
		case "off":
			return t.scheduleOff(crontab)
		}
		return ui.Usage("Unknown schedule option: %s (on or off)", args[0])
	}

	/*------ Show ------*/
	ui.Info("  %s", status.Schedule(t.P))
	for _, line := range schedule.Lines(crontab, t.P.Root) {
		ui.Info("    %s", ui.Dim(line))
	}
	if !ui.Interactive {
		return nil
	}
	turnOn := func() error { return t.scheduleOn(crontab) }
	type action struct {
		label string
		run   func() error
	}
	actions := []action{{"Turn on      back up every night, check every hour", turnOn}}
	if on {
		actions = []action{
			{"Write again  the same jobs, as this version of the tool writes them", turnOn},
			{"Turn off     remove the jobs from the crontab", func() error { return t.scheduleOff(crontab) }},
		}
	}
	actions = append(actions,
		action{"Test alert   send a test message to the chat", func() error { return t.Check([]string{"--test"}) }},
		action{"Back", func() error { return nil }})
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

func (t *Tool) scheduleOn(crontab string) error {
	dir := backup.Dir(t.P)
	// Cron appends to the log from its first run, and `>>` can't make the folder.
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return ui.Fail("Can't make the backups' folder %s: %v", dir, err)
	}
	logFile := schedule.LogFile(dir)
	if err := schedule.Write(schedule.With(crontab, t.P.Root, logFile)); err != nil {
		return err
	}
	ui.OK("Scheduled, in this user's crontab (in the server's time zone; `date` shows it):")
	for _, job := range schedule.Jobs {
		ui.Info("    %s", job.What)
	}
	ui.Info("  Their output goes to %s.", logFile)

	if lines := schedule.HandWritten(crontab, t.P.Root); len(lines) > 0 {
		ui.Warn("The crontab also has lines of its own that run this tool, so those jobs now run twice. Remove them " +
			"with crontab -e:")
		ui.Warn("%s", ui.Indent(strings.Join(lines, "\n"), "  "))
	}
	if !notify.Configured(t.P.EnvFile()) {
		ui.Warn("No chat is set for alerts, so a failed backup only shows in that file and in the status lines. " +
			"Set ERROR_VIEWER_NOTIFY_URL in Settings to be told.")
	}
	return nil
}

func (t *Tool) scheduleOff(crontab string) error {
	if !schedule.On(crontab, t.P.Root) {
		ui.Info("Nothing is scheduled.")
		return nil
	}
	if err := schedule.Write(schedule.Without(crontab, t.P.Root)); err != nil {
		return err
	}
	ui.OK("The schedule is off: no backup runs by itself now.")
	return nil
}

/*===== Check =====*/

// checkState holds the problems the last check found, so the hourly check only speaks when they change.
func (t *Tool) checkState() string { return runlog.Dir(t.P.Root) + "/check.state" }

// Check is the hourly job: it looks for trouble nobody is watching for (the app down, no recent backup, a disk
// nearly full, your own certificate about to expire) and sends it to the chat when it differs from what the last
// check found, and an all-clear once it's gone. `--test` sends a test message. It exits 1 while there's a problem.
func (t *Tool) Check(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	env := t.P.EnvFile()
	domain := envfile.Get(env, "DOMAIN")
	if len(args) == 1 && args[0] == "--test" {
		if err := notify.Send(env, "["+domain+"] A test message from the deploy tool. Alerts will arrive here."); err != nil {
			return ui.Fail("The test message wasn't sent: %v.", err)
		}
		ui.OK("Sent. Check the chat.")
		return nil
	}
	if len(args) > 0 {
		return ui.Usage("Unknown check option: %s (--test)", args[0])
	}

	/*------ Look ------*/
	// Red only for the lines that are also yellow in passing (the app starting, a disk filling slowly).
	var problems []string
	for _, c := range []struct {
		line    *status.Line
		redOnly bool
	}{
		{status.App(t.P, t.S), true},
		{status.Backup(t.P), false},
		{status.Disk(t.P), true},
		{status.SSL(t.P), false},
	} {
		if c.line.Color == status.Red || (c.line.Color == status.Yellow && !c.redOnly) {
			problems = append(problems, c.line.Label+": "+c.line.Text)
		}
	}
	found := strings.Join(problems, "\n")
	last, _ := os.ReadFile(t.checkState())
	changed := found != string(last)

	/*------ Tell ------*/
	// On a terminal always; from cron only what changed, so an hour-by-hour problem doesn't fill the log.
	if ui.Interactive || changed {
		if found == "" {
			ui.OK("Nothing needs attention.")
		} else {
			ui.Warn("Needs attention:\n%s", ui.Indent(found, "  "))
		}
	}
	if changed {
		if notify.Configured(env) {
			text := "[" + domain + "] All clear: the server's checks pass again."
			if found != "" {
				text = "[" + domain + "] The server needs attention:\n" + found
			}
			// Not recorded when it wasn't sent, so the next check tries again.
			if err := notify.Send(env, text); err != nil {
				return ui.Fail("The alert wasn't sent: %v.", err)
			}
		}
		_ = os.MkdirAll(runlog.Dir(t.P.Root), 0o755)
		_ = os.WriteFile(t.checkState(), []byte(found), 0o600)
	}
	if found != "" {
		return &ui.Failure{Code: 1}
	}
	return nil
}

// AlertFailure tells the chat that a command run without a terminal (by cron) failed: nobody was there to see it.
// logRel is the run's log file, empty when it kept none.
func (t *Tool) AlertFailure(command string, args []string, err error, logRel string) {
	env := t.P.EnvFile()
	if ui.Interactive || !t.P.IsSetUp() || !notify.Configured(env) {
		return
	}
	text := "[" + envfile.Get(env, "DOMAIN") + "] deploy/deploy.sh " + join(append([]string{command}, args...)) + " failed"
	if message := strings.TrimSpace(err.Error()); message != "" {
		text += ":\n" + message
	}
	if logRel != "" {
		text += "\nThe whole output: " + logRel
	}
	if sendErr := notify.Send(env, text); sendErr != nil {
		ui.Warn("The failure wasn't sent to the chat: %v.", sendErr)
	}
}
