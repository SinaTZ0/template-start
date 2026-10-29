// Package gitrepo runs the few git commands the tool needs, always with `-C <root>`.
package gitrepo

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"deploy/internal/interrupt"
	"deploy/internal/ui"
)

func output(root string, args ...string) (string, error) {
	out, err := exec.Command("git", append([]string{"-C", root}, args...)...).Output()
	return strings.TrimSpace(string(out)), err
}

// run runs git with its output on the terminal (and in the action's log).
func run(root string, args ...string) error {
	cmd := exec.CommandContext(interrupt.Context(), "git", append([]string{"-C", root}, args...)...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, ui.Out, ui.Err
	return interrupt.Check(cmd.Run())
}

// Version is the checked-out commit, 7 characters: the tag each build gives the app image.
func Version(root string) string {
	v, _ := output(root, "rev-parse", "--short=7", "HEAD")
	return v
}

// ShortHead is the checked-out commit as git abbreviates it.
func ShortHead(root string) string {
	v, _ := output(root, "rev-parse", "--short", "HEAD")
	return v
}

// TrackedChanges lists tracked files changed in the checkout (`git status --porcelain`), empty when there are none.
func TrackedChanges(root string) string {
	v, _ := output(root, "status", "--porcelain", "--untracked-files=no")
	return v
}

// Pull fast-forwards the checkout.
func Pull(root string) error { return run(root, "pull", "--ff-only") }

// Log prints the commits between two revisions, one line each.
func Log(root, from, to string) error {
	return run(root, "--no-pager", "log", "--oneline", from+".."+to)
}

// Subject is a commit's subject line, empty when git doesn't know the revision.
func Subject(root, rev string) string {
	v, _ := output(root, "log", "-1", "--format=%s", rev)
	return v
}

// HasUpstream reports whether the branch tracks a remote branch.
func HasUpstream(root string) bool {
	return exec.Command("git", "-C", root, "rev-parse", "-q", "--verify", "@{u}").Run() == nil
}

// Fetch fetches the upstream with a timeout, never prompting for credentials, so an unreachable or private remote
// can't hang the menu.
func Fetch(root string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "-C", root, "fetch", "-q")
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_SSH_COMMAND=ssh -o BatchMode=yes -o ConnectTimeout=5")
	return cmd.Run()
}

// Behind counts the upstream's commits the checkout doesn't have, and names the upstream's commit.
func Behind(root string) (int, string) {
	count, _ := output(root, "rev-list", "--count", "HEAD..@{u}")
	n, _ := strconv.Atoi(count)
	upstream, _ := output(root, "rev-parse", "--short", "@{u}")
	return n, upstream
}

// Clone clones url into target, with git's output on the terminal.
func Clone(url, target string) error {
	cmd := exec.CommandContext(interrupt.Context(), "git", "clone", url, target)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, ui.Out, ui.Err
	return interrupt.Check(cmd.Run())
}
