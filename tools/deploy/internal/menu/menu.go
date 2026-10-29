// Package menu is what the tool shows with no command: a header with the domain, the status lines, and the actions
// that fit the server (Set up before setup, everything else after). An action that fails or is stopped with Ctrl-C
// comes back to the menu instead of ending the tool. Each action keeps a log file (runlog).
package menu

import (
	"context"
	"errors"
	"fmt"
	"time"

	"charm.land/huh/v2"

	"deploy/internal/commands"
	"deploy/internal/envfile"
	"deploy/internal/interrupt"
	"deploy/internal/status"
	"deploy/internal/ui"
)

type item struct {
	key, label, hint string
	run              func(t *commands.Tool) error
}

var items = []item{
	{"setup", "Set up", "clone, create .env, first build", func(t *commands.Tool) error { return t.Setup(nil) }},
	{"update", "Update", "back up, pull, rebuild, swap in the new app", func(t *commands.Tool) error { return t.Update(nil) }},
	{"rollback", "Roll back", "run an earlier version of the app", func(t *commands.Tool) error { return t.Rollback(nil) }},
	{"env", "Settings", "check, edit .env, apply", func(t *commands.Tool) error { return t.Settings(nil) }},
	{"backup", "Back up", "database and/or media", func(t *commands.Tool) error { return t.Backup(nil) }},
	{"restore", "Restore", "from a backup file", func(t *commands.Tool) error { return t.Restore(nil) }},
	{"cert", "SSL certificate", "automatic or your own files", func(t *commands.Tool) error { return t.Cert(nil) }},
	{"status", "Status", "containers, health, disk", func(t *commands.Tool) error { return t.Status(nil) }},
	{"logs", "Logs", "pick a service, follow", func(t *commands.Tool) error { return t.Logs(nil) }},
	{"admin", "Make admin", "promote an account by email", func(t *commands.Tool) error { return t.Admin(nil) }},
	{"seed", "Seed", "sample content from the seeds", func(t *commands.Tool) error { return t.Seed(nil) }},
	{"steps", "Deploy steps", "list them, run the pending ones", func(t *commands.Tool) error { return t.Steps(nil) }},
	{"pgweb", "Database browser", "browse and edit the database, for a set time", func(t *commands.Tool) error {
		return t.Pgweb(nil)
	}},
}

// available: Set up is for a new server only; everything else needs it done.
func available(t *commands.Tool, it item) bool {
	if it.key == "setup" {
		return !t.P.IsSetUp()
	}
	return t.P.IsSetUp()
}

// Run shows the menu until Quit. Quitting right after an action failed is a failure too, so deploy/deploy.sh's tmux
// window, which closes after a clean exit, stays open with the error and its log's name in it.
func Run(t *commands.Tool) error {
	if !ui.Interactive {
		return ui.Fail("No terminal for the menu: pass a command (deploy/deploy.sh help).")
	}
	failed := ""
	for {
		interrupt.Reset()
		// After a failure the menu is drawn under it rather than over it, so the error stays on screen.
		it, quit, err := pick(t, failed == "")
		if err != nil {
			return err
		}
		if quit {
			if failed != "" {
				return ui.Fail("%s", failed)
			}
			return nil
		}
		if it == nil {
			continue
		}
		if !available(t, *it) {
			if it.key == "setup" {
				ui.Warn("Not available: this server is already set up.")
			} else {
				ui.Warn("Not available: set up first.")
			}
			ui.Pause()
			continue
		}
		// Without a checkout, Set up clones and hands over to the clone's own tool, which replaces this one.
		if it.key == "setup" && !t.P.IsCheckout() {
			return it.run(t)
		}

		log := t.OpenLog(it.key, nil)
		err = it.run(t)
		failed = ""
		switch {
		case errors.Is(err, interrupt.ErrInterrupted):
			fmt.Fprintln(ui.Err)
		case err != nil:
			ui.PrintError(err)
			failed = it.label + " failed (see above)."
			if log != nil {
				failed = it.label + " failed. The whole output: " + log.Rel
			}
		}
		log.Close(err)
		ui.Pause()
		if it.key == "update" && err == nil {
			return t.Restart()
		}
	}
}

// pick draws the menu, on a cleared screen or under what's there, and returns the chosen action, or quit. A nil item
// with quit unset means draw it again. Esc and Ctrl-C quit; any other error from the list is returned, not taken for
// a Quit nobody chose.
func pick(t *commands.Tool, clear bool) (*item, bool, error) {
	if clear {
		ui.Clear()
	} else {
		fmt.Fprintln(ui.Out)
	}
	fmt.Fprintf(ui.Out, "%s  %s\n\n", ui.Bold("Deploy"), envfile.Get(t.P.EnvFile(), "DOMAIN"))
	// A signal from while an action ran is answered by the lines checked now.
	select {
	case <-interrupt.Attached():
	default:
	}
	lines := status.Lines(t.P, t.S, t.Env)

	if ui.TUI {
		// The status first, boxed, and the actions in an arrow-key list under it. Only the available ones are listed.
		updates, refresh, stop := watchStatus(t, lines)
		defer stop()
		var options []huh.Option[int]
		choice := -1
		for i, it := range items {
			if available(t, it) {
				options = append(options, huh.NewOption(fmt.Sprintf("%-17s %s", it.label, ui.Dim(it.hint)), i))
				// The list starts on the first action, not on the Quit that an unset choice would match.
				if choice < 0 {
					choice = i
				}
			}
		}
		options = append(options, huh.NewOption("Quit", -1))
		field := huh.NewSelect[int]().Options(options...).Value(&choice).Height(len(options) + 1)
		above := ui.Above{Text: drawStatus(lines, time.Now(), false), Updates: updates, Keys: map[string]func(){"r": refresh}}
		if err := ui.RunFieldUnder(field, above); err != nil {
			if errors.Is(err, interrupt.ErrInterrupted) {
				return nil, true, nil
			}
			return nil, false, err
		}
		if choice < 0 {
			return nil, true, nil
		}
		return &items[choice], false, nil
	}

	rule := ui.Dim("─────────────────────────────────────────────────────")
	for i, it := range items {
		switch {
		case available(t, it):
			fmt.Fprintf(ui.Out, " %2d) %-17s %s\n", i+1, it.label, ui.Dim(it.hint))
		case it.key == "setup":
			fmt.Fprintln(ui.Out, ui.Dim(fmt.Sprintf(" %2d) %-17s (already set up)", i+1, it.label)))
		default:
			fmt.Fprintln(ui.Out, ui.Dim(fmt.Sprintf(" %2d) %-17s (set up first)", i+1, it.label)))
		}
	}
	fmt.Fprintf(ui.Out, "  0) Quit\n\n  %s\n", rule)
	for _, line := range lines {
		fmt.Fprintf(ui.Out, "  %s\n", line)
	}
	fmt.Fprintf(ui.Out, "  %s\n\n", rule)

	// Ctrl-C and Ctrl-D quit; Enter alone draws the menu again, with the status checked again.
	choice, err := ui.ReadLine("Choose (Enter checks the status again): ")
	if err != nil {
		return nil, true, nil
	}
	switch choice {
	case "0", "q", "Q":
		return nil, true, nil
	}
	var n int
	if _, err := fmt.Sscan(choice, &n); err != nil || n < 1 || n > len(items) {
		return nil, false, nil
	}
	return &items[n-1], false, nil
}

/*===== The Live Status =====*/

// refreshEvery is how often the status is checked again while the menu waits.
const refreshEvery = 5 * time.Minute

// watchStatus checks the status lines again while the list waits, and sends the box drawn anew: on someone attaching
// to the tmux window (deploy/tmux.conf), every few minutes, and when refresh is called (r). Otherwise a menu that
// waited in its window since yesterday would still show yesterday: commits pushed since, a backup that ran. stop ends
// it and closes updates. lines are the ones drawn first.
func watchStatus(t *commands.Tool, lines []string) (updates <-chan string, refresh, stop func()) {
	out := make(chan string)
	asked := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		defer close(out)
		ticker := time.NewTicker(refreshEvery)
		defer ticker.Stop()
		send := func(text string) bool {
			select {
			case out <- text:
				return true
			case <-ctx.Done():
				return false
			}
		}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			case <-asked:
			case <-interrupt.Attached():
			}
			// The old box stays while the checks run (a few seconds: a git fetch, a request to each domain).
			if !send(drawStatus(lines, time.Time{}, true)) {
				return
			}
			lines = status.Lines(t.P, t.S, t.Env)
			if !send(drawStatus(lines, time.Now(), false)) {
				return
			}
		}
	}()
	refresh = func() {
		select {
		case asked <- struct{}{}:
		default:
		}
	}
	return out, refresh, cancel
}

// drawStatus is the box of status lines with when they were checked under it, or that they're being checked again.
func drawStatus(lines []string, at time.Time, checking bool) string {
	note := "Checked at " + at.Format("15:04") + " · r checks again"
	if checking {
		note = "Checking again…"
	}
	return ui.Box(lines) + "\n  " + ui.Dim(note) + "\n"
}
