// Package stack drives the Docker Compose stack in compose.prod.yaml: container states and health waits, the build and
// zero-downtime deploy, and the app's kept versions. Everything goes through the docker CLI, so it behaves exactly as
// the commands an operator would type.
package stack

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"deploy/internal/interrupt"
	"deploy/internal/project"
	"deploy/internal/ui"
)

// Services are the long-running services, in the order `logs` offers them.
var Services = []string{"app", "caddy", "error-viewer", "db", "seaweedfs"}

const (
	// MinCompose is the oldest Compose that reads the stack (inline `configs`).
	MinCompose = "2.23.1"
	// KeepVersions is how many app images Roll back can go back to, newest first.
	KeepVersions = 3
	// HelperImage reads and writes the image store's volume for media backups. Any image with `sh`, `find` and `tar`
	// works.
	HelperImage = "busybox:1.37"
)

// Stack is the compose project in a checkout.
type Stack struct {
	Root string

	pgdata *bool
}

// New returns the stack in root.
func New(root string) *Stack { return &Stack{Root: root} }

/*===== Running Commands =====*/

// Command is a `docker compose` command for this stack, with extra environment variables (KEY=value) on top of the
// tool's own. Ctrl-C stops it with SIGINT, as it would a command typed at the terminal.
func (s *Stack) Command(env []string, args ...string) *exec.Cmd {
	full := append([]string{"compose", "--project-directory", s.Root, "-f", filepath.Join(s.Root, project.ComposeFile)},
		args...)
	return Docker(env, full...)
}

// Docker is a docker command; see Command.
func Docker(env []string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(interrupt.Context(), "docker", args...)
	cmd.Cancel = func() error { return cmd.Process.Signal(os.Interrupt) }
	cmd.WaitDelay = 10 * time.Second
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), env...)
	}
	return cmd
}

// Run runs `docker compose <args>` with its output on the terminal. Nothing reads the terminal: a command that did
// would swallow what the operator types ahead.
func (s *Stack) Run(args ...string) error {
	cmd := s.Command(nil, args...)
	cmd.Stdout, cmd.Stderr = ui.Out, ui.Err
	return interrupt.Check(cmd.Run())
}

// RunTo is Run with stderr sent to w (a spinner's held-back output).
func (s *Stack) RunTo(w io.Writer, args ...string) error {
	cmd := s.Command(nil, args...)
	cmd.Stdout, cmd.Stderr = w, w
	return interrupt.Check(cmd.Run())
}

// Output runs `docker compose <args>` and returns its stdout, trimmed.
func (s *Stack) Output(args ...string) (string, error) {
	out, err := s.Command(nil, args...).Output()
	return strings.TrimSpace(string(out)), err
}

// DockerOutput runs `docker <args>` and returns its stdout, trimmed.
func DockerOutput(args ...string) (string, error) {
	out, err := Docker(nil, args...).Output()
	return strings.TrimSpace(string(out)), err
}

// DockerQuiet runs `docker <args>`, with its errors on stderr and nothing else.
func DockerQuiet(args ...string) error {
	cmd := Docker(nil, args...)
	cmd.Stderr = ui.Err
	return interrupt.Check(cmd.Run())
}

/*===== Tools =====*/

// RequireTools checks for git and for a Docker with Compose new enough, and that Docker is reachable.
func RequireTools() error {
	var missing []string
	for _, tool := range []string{"git", "docker"} {
		if _, err := exec.LookPath(tool); err != nil {
			missing = append(missing, tool)
		}
	}
	if len(missing) > 0 {
		return ui.Fail("Missing: %s. Install them, then run this again.", strings.Join(missing, " "))
	}
	version, err := DockerOutput("compose", "version", "--short")
	if err != nil {
		return ui.Fail("Docker Compose v2 isn't installed (`docker compose version` failed).")
	}
	version = strings.TrimPrefix(version, "v")
	if !AtLeast(version, MinCompose) {
		return ui.Fail("Docker Compose %s is too old: the stack needs %s or later.", version, MinCompose)
	}
	if exec.Command("docker", "info").Run() != nil {
		user := os.Getenv("USER")
		return ui.Fail("Can't reach Docker. Is it running, and is %s in the docker group (or run this with sudo)?", user)
	}
	return nil
}

var versionNumbers = regexp.MustCompile(`^(\d+)(?:\.(\d+))?(?:\.(\d+))?`)

// AtLeast compares dotted versions by their first three numbers; anything after them (`-desktop.1`) is ignored.
func AtLeast(version, minimum string) bool {
	parse := func(v string) [3]int {
		var n [3]int
		if m := versionNumbers.FindStringSubmatch(v); m != nil {
			for i := range 3 {
				n[i], _ = strconv.Atoi(m[i+1])
			}
		}
		return n
	}
	a, b := parse(version), parse(minimum)
	for i := range 3 {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return true
}

/*===== Project =====*/

var nameLine = regexp.MustCompile(`(?m)^name:[ \t]*([A-Za-z0-9_.-]+)`)

// ProjectName is the compose project's name: `name:` in compose.prod.yaml, else the folder's. It's what Compose prefixes
// volumes with and labels containers and images with.
func (s *Stack) ProjectName() string {
	b, _ := os.ReadFile(filepath.Join(s.Root, project.ComposeFile))
	if m := nameLine.FindSubmatch(b); m != nil {
		return strings.ToLower(string(m[1]))
	}
	return strings.ToLower(filepath.Base(s.Root))
}

// PgdataExists reports whether the database volume exists, i.e. Postgres has already set its password: it reads
// POSTGRES_PASSWORD only when it first creates the database. When Docker can't tell, it counts as existing: asking is
// safe, while a newly generated password would lock the app out.
func (s *Stack) PgdataExists() bool {
	if s.pgdata == nil {
		exists := true
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if exec.CommandContext(ctx, "docker", "info").Run() == nil {
			exists = exec.CommandContext(ctx, "docker", "volume", "inspect", s.ProjectName()+"_pgdata").Run() == nil
		}
		s.pgdata = &exists
	}
	return *s.pgdata
}

/*===== Containers =====*/

// IDState is healthy, unhealthy or starting for a running container with a health check, else running, exited,
// restarting, …; missing when it's gone. A stopped container keeps its last health status, so that only counts while it
// runs.
func IDState(id string) string {
	format := `{{if not .State.Running}}{{.State.Status}}{{else if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}`
	state, err := DockerOutput("inspect", "-f", format, id)
	if err != nil || state == "" {
		return "missing"
	}
	return state
}

// ContainerID is a service's first container, running or not; empty when it has none.
func (s *Stack) ContainerID(service string) string {
	out, _ := s.Output("ps", "-a", "-q", service)
	id, _, _ := strings.Cut(out, "\n")
	return id
}

// State is a service's state, as IDState; missing when it has no container (or there's no stack yet).
func (s *Stack) State(service string) string {
	id := s.ContainerID(service)
	if id == "" {
		return "missing"
	}
	return IDState(id)
}

var errNotHealthy = errors.New("not healthy")

// waitFor polls state until it's healthy or running. An unhealthy container may still recover inside the wait, so only
// a stopped one ends it early.
func waitFor(state func() string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		switch state() {
		case "healthy", "running":
			return nil
		case "exited", "dead", "missing":
			return errNotHealthy
		}
		select {
		case <-interrupt.Context().Done():
			return interrupt.ErrInterrupted
		case <-time.After(3 * time.Second):
		}
	}
	return errNotHealthy
}

// WaitHealthy waits for a service to turn healthy.
func (s *Stack) WaitHealthy(service string, timeout time.Duration) error {
	return waitFor(func() string { return s.State(service) }, timeout)
}

// WaitContainer waits for one container to turn healthy.
func WaitContainer(id string, timeout time.Duration) error {
	return waitFor(func() string { return IDState(id) }, timeout)
}

// ReloadCaddy makes Caddy re-read its Caddyfile without dropping connections; force reloads an unchanged one, for new
// certificate files.
func (s *Stack) ReloadCaddy(force bool) error {
	args := []string{"exec", "-T", "caddy", "caddy", "reload", "--config", "/etc/caddy/Caddyfile"}
	if force {
		args = append(args, "--force")
	}
	var held bytes.Buffer
	if err := s.RunTo(&held, args...); err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(held.String()))
	}
	return nil
}
