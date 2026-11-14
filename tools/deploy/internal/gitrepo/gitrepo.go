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
	// GIT_SSH_COMMAND replaces the checkout's own ssh command, which names its deploy key: build on that one.
	ssh, _ := output(root, "config", "core.sshCommand")
	cmd.Env = quietEnv(ssh, "-o ConnectTimeout=5")
	return cmd.Run()
}

// quietEnv is the environment for a git command that must fail instead of asking: no username prompt, no ssh
// passphrase or host-key question. sshCommand is the ssh to build on ("" for plain ssh).
func quietEnv(sshCommand string, options ...string) []string {
	if sshCommand == "" {
		sshCommand = "ssh"
	}
	ssh := strings.Join(append([]string{sshCommand, "-o BatchMode=yes"}, options...), " ")
	return append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_SSH_COMMAND="+ssh)
}

// Behind counts the upstream's commits the checkout doesn't have, and names the upstream's commit.
func Behind(root string) (int, string) {
	count, _ := output(root, "rev-list", "--count", "HEAD..@{u}")
	n, _ := strconv.Atoi(count)
	upstream, _ := output(root, "rev-parse", "--short", "@{u}")
	return n, upstream
}

// Clone clones url into target, with git's output on the terminal. sshCommand, when given, is the ssh the clone uses
// and keeps using (`core.sshCommand`), so later pulls and fetches find the deploy key it names.
func Clone(url, target, sshCommand string) error {
	args := []string{"clone"}
	if sshCommand != "" {
		args = append(args, "-c", "core.sshCommand="+sshCommand)
	}
	cmd := exec.CommandContext(interrupt.Context(), "git", append(args, url, target)...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, ui.Out, ui.Err
	return interrupt.Check(cmd.Run())
}

/*===== Remote Access =====*/

// CanRead reports whether git can read the remote at url without asking for anything, and git's own message when it
// can't. sshCommand is the ssh to use ("" for plain ssh).
func CanRead(url, sshCommand string) (bool, string) {
	ctx, cancel := context.WithTimeout(interrupt.Context(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "ls-remote", "--heads", url)
	// accept-new: a new server has never met the git host, and without a terminal ssh refuses an unknown host. It
	// records the host's key on this first connection and refuses a different one afterwards.
	cmd.Env = quietEnv(sshCommand, "-o ConnectTimeout=10", "-o StrictHostKeyChecking=accept-new")
	out, err := cmd.CombinedOutput()
	if err == nil {
		return true, ""
	}
	if ctx.Err() != nil {
		return false, "no answer within 30 seconds"
	}
	return false, strings.TrimSpace(string(out))
}

// SSHURL is the SSH form of a repository URL (`git@github.com:owner/repo.git`), which a deploy key needs: an SSH URL
// as given, an https one converted. False for anything else, or an https URL with a port, which says nothing about
// the host's SSH port.
func SSHURL(url string) (string, bool) {
	if strings.HasPrefix(url, "ssh://") {
		return url, true
	}
	rest, isHTTP := strings.CutPrefix(url, "https://")
	if !isHTTP {
		rest, isHTTP = strings.CutPrefix(url, "http://")
	}
	if !isHTTP {
		// scp-like: user@host:path
		user, after, found := strings.Cut(url, "@")
		return url, found && user != "" && !strings.Contains(url, "://") && strings.Contains(after, ":")
	}
	host, path, found := strings.Cut(rest, "/")
	if _, afterUser, hasUser := strings.Cut(host, "@"); hasUser {
		host = afterUser
	}
	if !found || host == "" || path == "" || strings.Contains(host, ":") {
		return "", false
	}
	return "git@" + host + ":" + path, true
}

// Name is the repository's name from its URL (`repo` for `…/owner/repo.git`), with only the characters a file name
// can safely hold.
func Name(url string) string {
	name := strings.TrimSuffix(strings.TrimRight(url, "/"), ".git")
	if i := strings.LastIndexAny(name, "/:"); i >= 0 {
		name = name[i+1:]
	}
	safe := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.' {
			return r
		}
		return -1
	}, name)
	if strings.Trim(safe, ".") == "" {
		return "app"
	}
	return safe
}
