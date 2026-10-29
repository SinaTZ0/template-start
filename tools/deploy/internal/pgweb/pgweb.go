// Package pgweb opens and closes the database browser (github.com/sosedoff/pgweb), for emergencies: full read and
// write access to the whole database, as the app's own user, reachable only through an SSH tunnel and behind a sign-in
// made for that session. It closes itself after the time asked for, 24 hours at most.
//
// The browser uses the app's own database user, so its login can't be made to expire in Postgres: that would lock the
// app out too. The limit is enforced outside the database instead, twice. The container runs pgweb under `timeout`,
// with `restart: "no"`, so it stops on time even with the tool and the SSH session gone, and stays down after a
// reboot. And it carries its closing time as a label, which every run of the tool (cron's nightly backup included)
// checks, closing a browser that's past it.
package pgweb

import (
	"fmt"
	"io"
	"net/http"
	"os"
	osuser "os/user"
	"strconv"
	"strings"
	"time"

	"deploy/internal/backup"
	"deploy/internal/envfile"
	"deploy/internal/interrupt"
	"deploy/internal/project"
	"deploy/internal/settings"
	"deploy/internal/stack"
	"deploy/internal/ui"
)

const (
	// Service is the compose service, in the `tools` profile so a deploy never starts it.
	Service = "pgweb"
	Profile = "tools"
	// Port is where it listens, on the server's loopback only.
	Port = 8081
	// Max is the longest it may stay open, and the default.
	Max           = 24 * time.Hour
	closesAtLabel = "deploy.pgweb.closes-at"
)

// Browser is the browser's container.
type Browser struct {
	ID       string
	Running  bool
	ClosesAt time.Time
}

// Overdue reports whether it's past its time, or already stopped on its own.
func (b *Browser) Overdue() bool { return !b.Running || !time.Now().Before(b.ClosesAt) }

// Find returns the browser's container, nil when there's none.
func Find(s *stack.Stack) *Browser {
	id, err := stack.DockerOutput("ps", "-aq",
		"--filter", "label=com.docker.compose.project="+s.ProjectName(),
		"--filter", "label=com.docker.compose.service="+Service)
	if err != nil || id == "" {
		return nil
	}
	id, _, _ = strings.Cut(id, "\n")
	out, err := stack.DockerOutput("inspect", "-f",
		`{{.State.Running}} {{index .Config.Labels "`+closesAtLabel+`"}}`, id)
	if err != nil {
		return nil
	}
	running, epoch, _ := strings.Cut(out, " ")
	seconds, _ := strconv.ParseInt(epoch, 10, 64)
	return &Browser{ID: id, Running: running == "true", ClosesAt: time.Unix(seconds, 0)}
}

// CloseOverdue closes a browser that's past its time. Every run of the tool calls it.
func CloseOverdue(s *stack.Stack) {
	if b := Find(s); b != nil && b.Overdue() {
		if remove(b) == nil {
			ui.Info("%s", ui.Dim("Closed the database browser: its time was up."))
		}
	}
}

// remove stops and removes the container. That closes its database connections too: Postgres ends an idle session as
// soon as its socket closes, and a statement still running finishes first (outside a transaction its change is kept).
func remove(b *Browser) error {
	_ = stack.Docker(nil, "stop", "-t", "5", b.ID).Run()
	return stack.Docker(nil, "rm", "-f", b.ID).Run()
}

// Close closes the browser; with none open it does nothing and succeeds.
func Close(s *stack.Stack) error {
	b := Find(s)
	if b == nil {
		ui.Info("The database browser isn't open.")
		return nil
	}
	if err := remove(b); err != nil {
		return ui.Fail("Couldn't remove the database browser's container %s: docker rm -f %s", b.ID, b.ID)
	}
	ui.OK("Database browser closed.")
	return nil
}

// Status prints whether the browser is open, and until when.
func Status(s *stack.Stack) {
	b := Find(s)
	if b == nil || b.Overdue() {
		ui.Info("The database browser is closed.")
		return
	}
	ui.Info("The database browser is open until %s (%s left). Close it with: deploy/deploy.sh pgweb close",
		b.ClosesAt.Format("2006-01-02 15:04"), Left(b.ClosesAt))
}

// Left says how long until t, roughly: "3 h 20 min", "12 min".
func Left(t time.Time) string {
	d := time.Until(t).Round(time.Minute)
	if d < time.Minute {
		return "under a minute"
	}
	h, m := int(d.Hours()), int(d.Minutes())%60
	switch {
	case h == 0:
		return fmt.Sprintf("%d min", m)
	case m == 0:
		return fmt.Sprintf("%d h", h)
	default:
		return fmt.Sprintf("%d h %d min", h, m)
	}
}

// ParseDuration reads `--for`: Go durations (`30m`, `4h`, `1h30m`) and whole days (`1d`), from a minute to Max.
func ParseDuration(text string) (time.Duration, error) {
	var d time.Duration
	var err error
	if days, ok := strings.CutSuffix(text, "d"); ok {
		var n int
		n, err = strconv.Atoi(days)
		d = time.Duration(n) * 24 * time.Hour
	} else {
		d, err = time.ParseDuration(text)
	}
	if err != nil || d < time.Minute || d > Max {
		return 0, fmt.Errorf("--for takes a time from 1m to 24h, like 30m, 4h or 24h (got %q)", text)
	}
	return d, nil
}

// Open starts the browser for d, after a `-pre-pgweb` dump unless dump is false, and prints how to reach it and its
// sign-in, once.
func Open(p *project.Project, s *stack.Stack, d time.Duration, dump bool) error {
	password := envfile.Get(p.EnvFile(), "POSTGRES_PASSWORD")
	if password == "" {
		return ui.Fail("POSTGRES_PASSWORD is empty in .env, so there's nothing to sign in to the database with.")
	}
	if s.State("db") != "healthy" {
		return ui.Fail("The database isn't running, so there's nothing to browse.")
	}

	/*------ One at a Time ------*/
	// The sign-in is shown only once, so a lost one means opening again with a new one.
	if b := Find(s); b != nil {
		if !b.Overdue() {
			if !ui.Interactive {
				return ui.Fail("The database browser is already open, until %s. Close it first: deploy/deploy.sh pgweb close",
					b.ClosesAt.Format("2006-01-02 15:04"))
			}
			ok, err := ui.Confirm(fmt.Sprintf("The database browser is already open, until %s. Close it and open a new "+
				"one, with a new sign-in?", b.ClosesAt.Format("15:04")), true)
			if err != nil {
				return err
			}
			if !ok {
				return ui.Fail("Left the open one as it is.")
			}
		}
		if err := remove(b); err != nil {
			return ui.Fail("Couldn't remove the old browser's container: docker rm -f %s", b.ID)
		}
	}

	/*------ Backup ------*/
	// A mistaken UPDATE or DELETE in the browser is applied at once; this dump is the way back.
	dumpPath := ""
	if dump {
		ui.Step("Backing up the database first")
		dir := backup.Dir(p)
		path, err := backup.DB(s, dir, backup.Stamp(), "-pre-pgweb")
		if err != nil {
			return err
		}
		backup.Prune(p, dir)
		dumpPath = path
	}

	/*------ Start ------*/
	user := "pgweb-" + settings.Secret(4)
	pass := settings.Secret(16)
	closesAt := time.Now().Add(d).Truncate(time.Second)
	// Through the environment of this one `docker compose` call, which compose.prod.yaml reads; never through .env.
	env := []string{
		"PGWEB_AUTH_USER=" + user,
		"PGWEB_AUTH_PASS=" + pass,
		"PGWEB_SECONDS=" + strconv.Itoa(int(d.Seconds())),
		"PGWEB_CLOSES_AT=" + strconv.FormatInt(closesAt.Unix(), 10),
	}
	ui.Step("Starting the database browser")
	// `--no-deps`: the database runs already, and a pending .env edit mustn't recreate it here.
	up := s.Command(env, "--profile", Profile, "up", "-d", "--no-deps", "--force-recreate", Service)
	up.Stdout, up.Stderr = ui.Out, ui.Err
	if err := interrupt.Check(up.Run()); err != nil {
		if err == interrupt.ErrInterrupted {
			return err
		}
		return ui.Fail("The database browser didn't start (see above).")
	}
	if err := ui.Spin("Waiting for it to answer", func(io.Writer) error { return waitAnswering(30 * time.Second) }); err != nil {
		if b := Find(s); b != nil {
			logs := stack.Docker(nil, "logs", "--tail", "20", b.ID)
			logs.Stdout, logs.Stderr = ui.Err, ui.Err
			_ = logs.Run()
			_ = remove(b)
		}
		return interrupt.Check(ui.Fail("The database browser didn't answer on port %d (its last log lines are above), "+
			"so it was removed.", Port))
	}

	/*------ How to Reach It ------*/
	// The account the operator signed in as: sudo's caller, else this process's own. $USER can be unset (cron,
	// `docker exec`), so the user database decides last.
	login := os.Getenv("SUDO_USER")
	if login == "" {
		login = os.Getenv("USER")
	}
	if u, err := osuser.Current(); login == "" && err == nil {
		login = u.Username
	}
	domain := envfile.Get(p.EnvFile(), "DOMAIN")
	ui.OK("The database browser is open.")
	ui.Info("")
	ui.Info("  1. On your computer, open a tunnel (with the address you SSH to, if it isn't %s):", domain)
	ui.Info("       ssh -N -L %d:localhost:%d %s@%s", Port, Port, login, domain)
	ui.Info("  2. Then open http://localhost:%d and sign in:", Port)
	ui.Info("       username  %s", user)
	ui.Private("       password  %s", pass)
	ui.Info("")
	ui.Info("  It closes at %s (in %s), or now with: deploy/deploy.sh pgweb close", closesAt.Format("2006-01-02 15:04"),
		Left(closesAt))
	ui.Info("  The sign-in is shown only now. Lost it? Open the browser again for a new one.")
	ui.Warn("It has full read and write access to the whole database: a change there is applied at once.")
	if dumpPath != "" {
		ui.Info("  The database from before it opened: %s", dumpPath)
	}
	return nil
}

// waitAnswering waits for pgweb's HTTP server; any response (401 without the sign-in) means it's up.
func waitAnswering(timeout time.Duration) error {
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(timeout)
	url := fmt.Sprintf("http://127.0.0.1:%d/", Port)
	for {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			return nil
		}
		if time.Now().After(deadline) {
			return err
		}
		select {
		case <-interrupt.Context().Done():
			return interrupt.ErrInterrupted
		case <-time.After(time.Second):
		}
	}
}
