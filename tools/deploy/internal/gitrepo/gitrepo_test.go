package gitrepo

import (
	"errors"
	"testing"
)

// A deploy key only works over SSH, so the URL someone pastes from the browser has to become the SSH one.
func TestSSHURL(t *testing.T) {
	cases := []struct {
		url, want string
		ok        bool
	}{
		{"https://github.com/owner/repo.git", "git@github.com:owner/repo.git", true},
		{"https://token@gitlab.com/group/sub/repo", "git@gitlab.com:group/sub/repo", true},
		{"git@github.com:owner/repo.git", "git@github.com:owner/repo.git", true},
		{"ssh://git@example.com:2222/owner/repo.git", "ssh://git@example.com:2222/owner/repo.git", true},
		{"https://git.example.com:8443/owner/repo.git", "", false},
		{"/srv/git/repo.git", "", false},
	}
	for _, c := range cases {
		got, ok := SSHURL(c.url)
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("SSHURL(%q) = %q, %v; want %q, %v", c.url, got, ok, c.want, c.ok)
		}
	}
}

// A removed deploy key has to read as "refused", not as a network problem: the two send the operator to different
// places.
func TestRefused(t *testing.T) {
	if !Refused(errors.New("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.")) {
		t.Fatal("a refused key isn't recognised")
	}
	if Refused(errors.New("fatal: unable to access 'https://x.invalid/': Could not resolve host: x.invalid")) || Refused(nil) {
		t.Fatal("an unreachable host reads as refused")
	}
}
