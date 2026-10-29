// Package interrupt turns Ctrl-C into a cancelled context for the action that's running, instead of ending the
// process. Ctrl-C reaches the docker and git commands the tool runs as well (they're in the terminal's process group),
// so they stop on their own; the action then sees its context cancelled and returns ErrInterrupted, and the menu comes
// back. Outside the menu, main turns that into exit code 130. It also takes SIGUSR1, which deploy/tmux.conf sends
// when someone attaches to the menu's window (Attached).
package interrupt

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"sync"
	"syscall"
)

// ErrInterrupted is returned by whatever Ctrl-C (or Esc at a prompt) stopped.
var ErrInterrupted = errors.New("interrupted")

var (
	attached = make(chan os.Signal, 1)

	mu     sync.Mutex
	ctx    context.Context
	cancel context.CancelFunc
)

// Listen starts catching SIGINT, SIGTERM, SIGHUP and SIGUSR1. Call it once, at start-up.
func Listen() {
	Reset()
	// From the start, whatever the tool runs: SIGUSR1's default would end it, and tmux sends it to any deploy tool in
	// the window, a command typed in the shell that stays after a failure included.
	signal.Notify(attached, syscall.SIGUSR1)
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		for sig := range signals {
			mu.Lock()
			cancel()
			mu.Unlock()
			// A terminal that closes, or a `kill`, ends the process; only Ctrl-C hands control back to the menu.
			if sig != os.Interrupt {
				os.Exit(130)
			}
		}
	}()
}

// Attached delivers a SIGUSR1: someone attached to the tmux window. One that arrived while nobody was reading waits
// here, a single one however many came.
func Attached() <-chan os.Signal { return attached }

// Reset gives the next action a fresh context.
func Reset() {
	mu.Lock()
	defer mu.Unlock()
	ctx, cancel = context.WithCancel(context.Background())
}

// Context is cancelled by the next Ctrl-C.
func Context() context.Context {
	mu.Lock()
	defer mu.Unlock()
	if ctx == nil {
		ctx, cancel = context.WithCancel(context.Background())
	}
	return ctx
}

// Happened reports whether Ctrl-C was pressed since the last Reset.
func Happened() bool { return Context().Err() != nil }

// Check returns ErrInterrupted once Ctrl-C was pressed, so a step that failed because its command was stopped reads
// as stopped, not as failed.
func Check(err error) error {
	if Happened() {
		return ErrInterrupted
	}
	return err
}
