package commands

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"deploy/internal/gitrepo"
	"deploy/internal/interrupt"
	"deploy/internal/ui"
)

/*===== Deploy Key =====*/

// deployKeyAccess gives this server read access to a repository it can't read, a private one: it makes an SSH key
// for the project, shows the public half to add to the repository as a read-only deploy key, and waits until git can
// read with it. A deploy key reaches one repository, can't push and belongs to no account, unlike an access token.
// It returns the URL to clone (the SSH form) and the ssh command that uses the key. reason is git's message from the
// failed read.
func (t *Tool) deployKeyAccess(url, reason string) (sshURL, sshCommand string, err error) {
	ui.Warn("This server can't read %s:", url)
	ui.Warn("%s", ui.Indent(reason, "  "))
	choice, err := ui.Choose("What now?", []string{
		"Deploy key   the repository is private: make a key for this server and add it there, read-only",
		"Stop         fix the URL or the connection, then run Set up again",
	})
	if err != nil {
		return "", "", err
	}
	if choice == 1 {
		return "", "", ui.Fail("Nothing was cloned.")
	}
	sshURL, ok := gitrepo.SSHURL(url)
	if !ok {
		return "", "", ui.Fail("A deploy key works over SSH, and %s has no SSH form the tool can work out. "+
			"Run Set up again with the repository's SSH URL (git@host:owner/repo.git).", url)
	}

	/*------ The key ------*/
	ui.Step("Deploy key")
	key, public, err := deployKey(gitrepo.Name(url))
	if err != nil {
		return "", "", err
	}
	// IdentitiesOnly: an ssh agent's other keys would be offered first, and GitHub takes the first key it knows,
	// which may be an account's.
	sshCommand = "ssh -i " + shellQuote(key) + " -o IdentitiesOnly=yes"
	ui.Info("This server's key for the repository (the private half stays in %s):", key)
	ui.Info("")
	ui.Info("  %s", public)
	ui.Info("")
	ui.Info("Add that line to the repository as a deploy key, without write access:")
	ui.Info("  %s", deployKeysPage(sshURL))

	/*------ Wait for it ------*/
	for {
		added, err := ui.Confirm("Added it?", true)
		if err != nil {
			return "", "", err
		}
		if !added {
			return "", "", ui.Fail("Nothing was cloned. The key is kept, so Set up shows the same one next time.")
		}
		ok, reason := gitrepo.CanRead(sshURL, sshCommand)
		if ok {
			ui.OK("The server can read the repository.")
			return sshURL, sshCommand, nil
		}
		ui.Warn("Still can't read %s:", sshURL)
		ui.Warn("%s", ui.Indent(reason, "  "))
	}
}

// deployKey returns the project's key in ~/.ssh (`<name>_deploy_ed25519`) and its public line, making the pair when
// it isn't there yet. A key from an earlier, unfinished Set up is used again: it may already be on the repository.
func deployKey(name string) (path, public string, err error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", ui.Fail("Can't find the home folder to keep the key in: %v", err)
	}
	dir := filepath.Join(home, ".ssh")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", "", err
	}
	path = filepath.Join(dir, name+"_deploy_ed25519")
	if _, statErr := os.Stat(path); statErr != nil {
		if _, err := exec.LookPath("ssh-keygen"); err != nil {
			return "", "", ui.Fail("ssh-keygen isn't installed (the openssh-client package). Install it, then run this again.")
		}
		host, _ := os.Hostname()
		// No passphrase: Update and the status check run git without anyone to type one.
		cmd := exec.CommandContext(interrupt.Context(), "ssh-keygen", "-q", "-t", "ed25519", "-N", "",
			"-C", "deploy@"+host, "-f", path)
		cmd.Stdout, cmd.Stderr = ui.Out, ui.Err
		if err := interrupt.Check(cmd.Run()); err != nil {
			return "", "", err
		}
	}
	line, err := os.ReadFile(path + ".pub")
	if err != nil {
		return "", "", ui.Fail("%s has no public half next to it (%s.pub). Remove the key, then run this again.", path, path)
	}
	return path, strings.TrimSpace(string(line)), nil
}

// deployKeysPage says where a repository's deploy keys are added: the page itself on GitHub, where to look elsewhere.
func deployKeysPage(sshURL string) string {
	if path, ok := strings.CutPrefix(sshURL, "git@github.com:"); ok {
		return "https://github.com/" + strings.TrimSuffix(path, ".git") + "/settings/keys/new"
	}
	return "the repository's settings → Deploy keys (GitLab: Repository → Deploy keys; Bitbucket: Access keys)"
}

// shellQuote quotes s for the shell git runs `core.sshCommand` through.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
