// Package lock keeps two actions from changing the same checkout at once: cron's nightly backup starting in the
// middle of an Update, or a second terminal running Restore while the first one deploys. An action holds the lock
// (`flock` on deploy/logs/.lock) from its start to its end; the kernel drops it when the process ends, however it
// ends, so a crash never leaves the checkout locked.
package lock

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"deploy/internal/runlog"
	"deploy/internal/ui"
)

// envVar tells a deploy tool run as a child (Update's `apply --after-update`) that its parent holds the lock, so the
// child doesn't wait for it forever.
const envVar = "DEPLOY_LOCK_HELD"

// Acquire takes the checkout's lock for an action and returns what releases it. When another action holds it, this
// one fails at once, naming the other: waiting would run a backup or a deploy at a time nobody chose.
func Acquire(root, command string) (release func(), err error) {
	if os.Getenv(envVar) != "" {
		return func() {}, nil
	}
	dir := runlog.Dir(root)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(dir, ".lock"), os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		defer f.Close()
		if !errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, err
		}
		holder, _ := os.ReadFile(f.Name())
		if who := strings.TrimSpace(string(holder)); who != "" {
			return nil, ui.Fail("Another deploy action is running on this server (%s). Run this again when it's done.", who)
		}
		return nil, ui.Fail("Another deploy action is running on this server. Run this again when it's done.")
	}

	// Who holds it, for the other side's message. The file stays after the release; only the flock means "held".
	_ = f.Truncate(0)
	_, _ = fmt.Fprintf(f, "%s, started at %s, process %d\n", command, time.Now().Format("15:04"), os.Getpid())
	_ = os.Setenv(envVar, "1")
	return func() {
		_ = os.Unsetenv(envVar)
		_ = f.Truncate(0)
		_ = f.Close()
	}, nil
}
