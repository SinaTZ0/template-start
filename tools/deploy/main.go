// The deploy tool: sets up, updates, backs up and checks the production stack on its server (docs/deployment.md → The
// Deploy Tool). It's built into deploy/bin/linux-<arch>/deploy and committed, and deploy/deploy.sh runs it.
//
//	deploy/deploy.sh             a menu, with the stack's status under it
//	deploy/deploy.sh <command>   the same actions without the menu, for cron and scripts (`deploy/deploy.sh help`)
//
// Exit codes: 0 done, 1 failed (or `env --check` found problems), 2 a command line it doesn't understand, 130 stopped
// with Ctrl-C.
package main

import (
	"errors"
	"fmt"
	"os"

	"deploy/internal/commands"
	"deploy/internal/interrupt"
	"deploy/internal/menu"
	"deploy/internal/pgweb"
	"deploy/internal/project"
	"deploy/internal/runlog"
	"deploy/internal/ui"
)

func main() {
	interrupt.Listen()
	p := project.Find()
	t := commands.New(p)

	command, args := "menu", []string(nil)
	if len(os.Args) > 1 {
		command, args = os.Args[1], os.Args[2:]
	}
	if command == "help" || command == "-h" || command == "--help" {
		commands.Help(ui.Out)
		return
	}
	// Any run closes a database browser that's past its time, cron's nightly backup included.
	if p.IsSetUp() {
		pgweb.CloseOverdue(t.S)
	}

	run := map[string]func([]string) error{
		"menu":     func([]string) error { return menu.Run(t) },
		"setup":    t.Setup,
		"update":   t.Update,
		"rollback": t.Rollback,
		"env":      t.Settings,
		"apply":    t.Apply,
		"backup":   t.Backup,
		"restore":  t.Restore,
		"cert":     t.Cert,
		"status":   t.Status,
		"logs":     t.Logs,
		"admin":    t.Admin,
		"seed":     t.Seed,
		"steps":    t.Steps,
		"pgweb":    t.Pgweb,
	}[command]
	if run == nil {
		commands.Help(ui.Err)
		os.Exit(2)
	}
	// The menu keeps a log per action it runs.
	var log *runlog.Log
	if command != "menu" {
		log = t.OpenLog(command, args)
	}
	err := run(args)
	code := exitCode(err)
	log.Close(err)
	os.Exit(code)
}

// exitCode prints err the way the menu does and maps it to the exit code.
func exitCode(err error) int {
	var failure *ui.Failure
	var usage *ui.UsageError
	switch {
	case err == nil:
		return 0
	case errors.Is(err, interrupt.ErrInterrupted):
		fmt.Fprintln(ui.Err)
		return 130
	case errors.As(err, &usage):
		ui.PrintError(err)
		return 2
	case errors.As(err, &failure):
		ui.PrintError(err)
		if failure.Code != 0 {
			return failure.Code
		}
		return 1
	default:
		ui.PrintError(err)
		return 1
	}
}
