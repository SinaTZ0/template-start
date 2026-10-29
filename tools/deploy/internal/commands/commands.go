// Package commands holds the tool's actions, one per command. The menu runs the same functions, so a command and its
// menu entry never drift apart.
package commands

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"deploy/internal/envfile"
	"deploy/internal/interrupt"
	"deploy/internal/project"
	"deploy/internal/runlog"
	"deploy/internal/stack"
	"deploy/internal/ui"
)

// Tool is the checkout the commands act on.
type Tool struct {
	P   *project.Project
	S   *stack.Stack
	Env *envfile.Settings
}

// New returns the commands for a checkout.
func New(p *project.Project) *Tool {
	s := stack.New(p.Root)
	return &Tool{
		P: p,
		S: s,
		Env: &envfile.Settings{
			Env: p.EnvFile(), Example: p.ExampleFile(), Applied: p.AppliedFile(), Dir: p.Root,
			PgdataExists: s.PgdataExists,
		},
	}
}

// OpenLog starts the log file of a command (runlog), for the ones that change something, and only in a checkout:
// Set up before the clone has nowhere to keep it, and hands over to the clone's tool, which keeps its own. Status
// and Logs only look. Nil when there's none; Close on nil does nothing.
func (t *Tool) OpenLog(command string, args []string) *runlog.Log {
	if command == "status" || command == "logs" || !t.P.IsCheckout() {
		return nil
	}
	return runlog.Open(t.P.Root, command, args)
}

func (t *Tool) requireSetUp() error {
	if !t.P.IsSetUp() {
		return ui.Fail("Set up first.")
	}
	return nil
}

// noArgs fails on any argument, for the commands that take none.
func noArgs(command string, args []string) error {
	if len(args) > 0 {
		return ui.Usage("Unknown %s option: %s (see deploy/deploy.sh help)", command, args[0])
	}
	return nil
}

// runTool runs this checkout's deploy/deploy.sh as a child, with the terminal, and passes its failure on without a
// second message: the child already printed it. Update uses it to hand over to the pulled binary.
func runTool(root string, args ...string) error {
	cmd := exec.Command("bash", append([]string{filepath.Join(root, "deploy", "deploy.sh")}, args...)...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	err := cmd.Run()
	if exitErr, ok := err.(*exec.ExitError); ok {
		if exitErr.ExitCode() == 130 || interrupt.Happened() {
			return interrupt.ErrInterrupted
		}
		return &ui.Failure{Code: exitErr.ExitCode()}
	}
	return err
}

// Restart replaces this process with the checkout's own tool and no arguments: the menu, after an Update pulled a new
// binary, so the menu that comes back is the new one's.
func (t *Tool) Restart() error { return execTool(t.P.Root) }

// execTool replaces this process with another checkout's deploy/deploy.sh, for Set up run outside a checkout.
func execTool(root string, args ...string) error {
	bash, err := exec.LookPath("bash")
	if err != nil {
		return err
	}
	return syscall.Exec(bash, append([]string{"bash", filepath.Join(root, "deploy", "deploy.sh")}, args...), os.Environ())
}

// truncate cuts s to n characters.
func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// join lists items space-separated.
func join(items []string) string { return strings.Join(items, " ") }
