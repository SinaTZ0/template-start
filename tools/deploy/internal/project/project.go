// Package project finds the checkout the tool manages and names its files.
package project

import (
	"os"
	"os/exec"
	"path/filepath"
)

// ComposeFile is the production stack, relative to the root.
const ComposeFile = "compose.prod.yaml"

// Project is a checkout of the repository on the server, or the folder the binary sits in when it's run on its own,
// before the repository is cloned.
type Project struct{ Root string }

// Find locates the checkout from the binary's own path (`<root>/deploy/bin/linux-<arch>/deploy`), so the tool works
// from any folder, cron's included. DEPLOY_ROOT overrides it, for running the tool from its source.
func Find() *Project {
	if root := os.Getenv("DEPLOY_ROOT"); root != "" {
		abs, err := filepath.Abs(root)
		if err == nil {
			return &Project{Root: abs}
		}
	}
	exe, err := os.Executable()
	if err == nil {
		exe, err = filepath.EvalSymlinks(exe)
	}
	if err != nil {
		wd, _ := os.Getwd()
		return &Project{Root: wd}
	}
	dir := filepath.Dir(exe)
	for range 4 {
		if fileExists(filepath.Join(dir, ComposeFile)) {
			return &Project{Root: dir}
		}
		dir = filepath.Dir(dir)
	}
	return &Project{Root: filepath.Dir(exe)}
}

// Path joins rel to the root.
func (p *Project) Path(rel ...string) string {
	return filepath.Join(append([]string{p.Root}, rel...)...)
}

func (p *Project) EnvFile() string     { return p.Path(".env") }
func (p *Project) ExampleFile() string { return p.Path(".env.production.example") }

// AppliedFile holds `<fingerprint> <epoch>` of the .env the running stack was last deployed with.
func (p *Project) AppliedFile() string { return p.Path(".env.applied") }
func (p *Project) CertDir() string     { return p.Path("certs") }

// IsCheckout reports whether the root holds the stack and is a git checkout.
func (p *Project) IsCheckout() bool {
	if !fileExists(p.Path(ComposeFile)) {
		return false
	}
	return exec.Command("git", "-C", p.Root, "rev-parse", "--git-dir").Run() == nil
}

// IsSetUp reports whether Set up has run: a checkout with a .env.
func (p *Project) IsSetUp() bool { return p.IsCheckout() && fileExists(p.EnvFile()) }

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ExpandHome expands a leading `~` to the home folder, as the shell would have.
func ExpandHome(path string) string {
	if path == "~" || len(path) > 1 && path[:2] == "~/" {
		if home, err := os.UserHomeDir(); err == nil {
			return home + path[1:]
		}
	}
	return path
}
