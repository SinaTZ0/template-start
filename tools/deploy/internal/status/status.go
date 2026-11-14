// Package status draws the status lines the menu and `status` show: green is fine, yellow needs attention, red is
// missing or broken, and each also says it in words. The checks run side by side, so the slowest (a git fetch, a
// request to each domain) sets how long the lines take, not their sum.
package status

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"syscall"
	"time"

	"deploy/internal/backup"
	"deploy/internal/certs"
	"deploy/internal/envfile"
	"deploy/internal/gitrepo"
	"deploy/internal/offsite"
	"deploy/internal/pgweb"
	"deploy/internal/ports"
	"deploy/internal/project"
	"deploy/internal/schedule"
	"deploy/internal/settings"
	"deploy/internal/stack"
	"deploy/internal/steps"
	"deploy/internal/ui"
)

// Color is a status line's dot.
type Color int

const (
	Green Color = iota
	Yellow
	Red
	Dim
)

// Line is one status line.
type Line struct {
	Color Color
	Label string
	Text  string
}

// String is the line as printed: `● Label        text`, the dot coloured.
func (l Line) String() string {
	dot := map[Color]func(string) string{Green: ui.Green, Yellow: ui.Yellow, Red: ui.Red, Dim: ui.Dim}[l.Color]("●")
	return fmt.Sprintf("%s %-13s%s", dot, l.Label, l.Text)
}

const stamp = "2006-01-02 15:04"

// Lines computes every status line, in their order. The database browser's appears only while it's open.
func Lines(p *project.Project, s *stack.Stack, env *envfile.Settings) []string {
	checks := []func() *Line{
		func() *Line { return Project(p) },
		func() *Line {
			if !p.IsSetUp() {
				return nil
			}
			return App(p, s)
		},
		func() *Line { return Settings(p, env) },
		func() *Line {
			if !p.IsSetUp() {
				return nil
			}
			return Steps(p, s)
		},
		func() *Line { return URL("Site", envfile.Get(p.EnvFile(), "DOMAIN")) },
		func() *Line { return URL("Errors", envfile.Get(p.EnvFile(), "ERRORS_DOMAIN")) },
		func() *Line { return Ports(s) },
		func() *Line { return SSL(p) },
		func() *Line { return Backup(p) },
		func() *Line {
			if !p.IsSetUp() {
				return nil
			}
			return Offsite(p)
		},
		func() *Line {
			if !p.IsSetUp() {
				return nil
			}
			return Schedule(p)
		},
		func() *Line {
			if !p.IsSetUp() {
				return nil
			}
			return Disk(p)
		},
		func() *Line {
			if !p.IsSetUp() {
				return nil
			}
			return Pgweb(s)
		},
	}
	results := make([]*Line, len(checks))
	var wg sync.WaitGroup
	for i, check := range checks {
		wg.Go(func() { results[i] = check() })
	}
	wg.Wait()
	var out []string
	for _, line := range results {
		if line != nil {
			out = append(out, line.String())
		}
	}
	return out
}

/*===== The Lines =====*/

// Project compares the checked-out commit with its upstream. A remote that turns the server away (gitrepo.Refused)
// is told apart from one that can't be reached.
func Project(p *project.Project) *Line {
	if !p.IsCheckout() {
		return &Line{Red, "Project", "not set up"}
	}
	head := gitrepo.ShortHead(p.Root)
	switch {
	case gitrepo.TrackedChanges(p.Root) != "":
		return &Line{Yellow, "Project", fmt.Sprintf("local changes  (%s)", head)}
	case !gitrepo.HasUpstream(p.Root):
		return &Line{Yellow, "Project", fmt.Sprintf("%s  (no upstream branch)", head)}
	}
	if err := gitrepo.Fetch(p.Root, 8*time.Second); gitrepo.Refused(err) {
		// Red: until the server can read the repository again, no update reaches it.
		return &Line{Red, "Project", fmt.Sprintf("%s  (the remote refused this server: was its deploy key removed?)", head)}
	} else if err != nil {
		return &Line{Yellow, "Project", fmt.Sprintf("%s  (couldn't reach the remote)", head)}
	}
	behind, upstream := gitrepo.Behind(p.Root)
	if behind == 0 {
		return &Line{Green, "Project", fmt.Sprintf("up to date  (%s)", head)}
	}
	return &Line{Yellow, "Project", fmt.Sprintf("%d behind  (%s → %s)", behind, head, upstream)}
}

// App is the version the app runs and its health. Yellow when it isn't the checkout (rolled back, or an update that
// didn't finish).
func App(p *project.Project, s *stack.Stack) *Line {
	state := s.State("app")
	if state == "missing" {
		return &Line{Red, "App", "not running"}
	}
	version, head := s.RunningVersion(), gitrepo.Version(p.Root)
	text := fmt.Sprintf("%s  %s", or(version, "untagged"), state)
	color := Green
	switch state {
	case "healthy":
	case "starting":
		color = Yellow
	default:
		color = Red
	}
	if version != "" && version != head {
		text += fmt.Sprintf("  (the checkout is %s)", head)
		if color != Red {
			color = Yellow
		}
	}
	return &Line{color, "App", text}
}

// Settings says whether .env has every setting, and whether the running stack uses it.
func Settings(p *project.Project, env *envfile.Settings) *Line {
	info, err := os.Stat(env.Env)
	if err != nil {
		return &Line{Red, "Settings", "not configured"}
	}
	var missing, invalid []string
	for _, problem := range env.Problems(env.Env) {
		switch problem.State {
		case settings.Missing:
			missing = append(missing, problem.Key)
		case settings.Invalid:
			invalid = append(invalid, problem.Key)
		}
	}
	if len(missing)+len(invalid) > 0 {
		var parts []string
		if len(missing) > 0 {
			parts = append(parts, "missing: "+envfile.JoinComma(missing))
		}
		if len(invalid) > 0 {
			parts = append(parts, "invalid: "+envfile.JoinComma(invalid))
		}
		return &Line{Red, "Settings", strings.Join(parts, "  ")}
	}

	edited := info.ModTime()
	switch env.State() {
	case envfile.Untracked:
		return &Line{Dim, "Settings", fmt.Sprintf("edited %s, not tracked yet", edited.Format(stamp))}
	case envfile.Pending:
		return &Line{Yellow, "Settings", fmt.Sprintf("edited %s, not applied", edited.Format(stamp))}
	}
	_, appliedAt := env.AppliedAt()
	text := "applied " + appliedAt.Format(stamp)
	if edited.Truncate(time.Second).After(appliedAt) {
		text += fmt.Sprintf("  (edited %s)", edited.Format(stamp))
	}
	return &Line{Green, "Settings", text}
}

// Steps counts the deploy steps that haven't run: red when one stopped partway, yellow when some are waiting for the
// next deploy.
func Steps(p *project.Project, s *stack.Stack) *Line {
	ledger, err := steps.Read(s)
	if err != nil {
		return &Line{Dim, "Steps", "unknown (the database isn't running, or no deploy has made the ledger yet)"}
	}
	if !ledger.Started() {
		return &Line{Dim, "Steps", "the next deploy starts the ledger"}
	}
	all, err := steps.Load(p.Root)
	if err != nil {
		return &Line{Red, "Steps", "can't read " + steps.Dir}
	}
	pending := steps.Pending(all, ledger)
	if len(pending) == 0 {
		return &Line{Green, "Steps", "all done"}
	}
	for _, step := range pending {
		if row, ok := ledger.Rows[step.Name]; ok {
			return &Line{Red, "Steps", fmt.Sprintf("%s stopped at command %d of %d  (deploy/deploy.sh steps)",
				step.Name, row.Done+1, row.Commands)}
		}
	}
	return &Line{Yellow, "Steps", fmt.Sprintf("%d pending  (the next update runs them, or deploy/deploy.sh steps)",
		len(pending))}
}

// URL requests the domain's /healthz from outside, through Caddy, the way a visitor would.
func URL(label, domain string) *Line {
	if domain == "" {
		return &Line{Red, label, "not configured"}
	}
	url := "https://" + domain
	text := func(result string) string { return fmt.Sprintf("%-30s %s", url, result) }
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(url + "/healthz")
	if err != nil {
		var dnsErr *net.DNSError
		var unknownCA x509.UnknownAuthorityError
		var hostname x509.HostnameError
		var invalid x509.CertificateInvalidError
		var verify *tls.CertificateVerificationError
		var alert tls.AlertError
		switch {
		case errors.As(err, &dnsErr):
			return &Line{Red, label, text("DNS doesn't resolve")}
		case errors.As(err, &unknownCA), errors.As(err, &hostname), errors.As(err, &invalid),
			errors.As(err, &verify), errors.As(err, &alert), strings.Contains(err.Error(), "tls:"):
			return &Line{Yellow, label, text("certificate not trusted")}
		default:
			return &Line{Red, label, text("no response")}
		}
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return &Line{Green, label, text("200 OK")}
	}
	return &Line{Yellow, label, text(fmt.Sprint(resp.StatusCode))}
}

// Ports says whether Caddy holds 80 and 443. Docker publishes them through `docker-proxy`, or with no listening process
// at all (iptables only), so either counts as Caddy's while its container runs.
func Ports(s *stack.Stack) *Line {
	caddy := s.State("caddy") == "running"
	var parts []string
	bad := false
	for _, port := range []int{80, 443} {
		owner := ports.Owner(port)
		switch {
		case caddy && (owner == "" || owner == "docker-proxy" || owner == "unknown"):
			parts = append(parts, fmt.Sprintf("%d ✓", port))
		case owner == "":
			parts = append(parts, fmt.Sprintf("%d ✗", port))
			bad = true
		default:
			parts = append(parts, fmt.Sprintf("%d ✗ (%s)", port, owner))
			bad = true
		}
	}
	text := strings.Join(parts, "  ")
	switch {
	case !bad:
		return &Line{Green, "Ports", text + "  (Caddy)"}
	case !caddy:
		return &Line{Red, "Ports", text + "  (Caddy isn't running)"}
	default:
		return &Line{Red, "Ports", text}
	}
}

// SSL says where the certificates come from, and when your own expires: yellow under 30 days.
func SSL(p *project.Project) *Line {
	if _, err := os.Stat(p.EnvFile()); err != nil {
		return &Line{Red, "SSL", "not configured"}
	}
	if envfile.Get(p.EnvFile(), "TLS_MODE") != "files" {
		return &Line{Green, "SSL", "automatic (Let's Encrypt)"}
	}
	end, err := certs.Expiry(p.Path("certs", "fullchain.pem"))
	if err != nil {
		return &Line{Red, "SSL", "own certificate missing from certs/"}
	}
	date := end.Local().Format(time.DateOnly)
	if !end.After(time.Now()) {
		return &Line{Red, "SSL", "own certificate, expired " + date}
	}
	days := int(time.Until(end).Hours() / 24)
	text := fmt.Sprintf("own certificate, expires %s  (%d days)", date, days)
	if days < 30 {
		return &Line{Yellow, "SSL", text}
	}
	return &Line{Green, "SSL", text}
}

// Backup is when the newest backup ran: yellow once it's older than BackupMaxAge. It also says when a backup last
// restored as a test (the verify command), once one did.
func Backup(p *project.Project) *Line {
	files := backup.List(backup.Dir(p))
	if len(files) == 0 {
		return &Line{Red, "Last backup", "none yet"}
	}
	when := files[0].Modified
	text := fmt.Sprintf("%s  (%s)", when.Format(stamp), Ago(when))
	if tested := backup.LastVerified(p.Root); !tested.IsZero() {
		text += ", restore tested " + Ago(tested)
	}
	if time.Since(when) > BackupMaxAge(p) {
		return &Line{Yellow, "Last backup", text}
	}
	return &Line{Green, "Last backup", text}
}

// Offsite is when a backup last reached the off-site bucket (package offsite): nil while off-site backups are off,
// yellow once the copy is older than BackupMaxAge, red when the settings are half filled in. It reads the time the
// last upload left on this server, not the bucket.
func Offsite(p *project.Project) *Line {
	const label = "Off-site"
	config, err := offsite.Load(p.EnvFile())
	if err != nil {
		return &Line{Red, label, err.Error() + "  (deploy/deploy.sh offsite)"}
	}
	if config == nil {
		return nil
	}
	when := offsite.Last(offsite.StateFile(p.Root))
	if when.IsZero() {
		return &Line{Yellow, label, "nothing copied to " + config.Bucket + " yet  (deploy/deploy.sh offsite)"}
	}
	text := fmt.Sprintf("%s  (%s, bucket %s)", when.Local().Format(stamp), Ago(when), config.Bucket)
	if config.Password == "" {
		text += ", without .env"
	}
	if time.Since(when) > BackupMaxAge(p) {
		return &Line{Yellow, label, text}
	}
	return &Line{Green, label, text}
}

// BackupMaxAge is how old the newest backup may be: two days with the nightly schedule on, which is one missed night
// and some slack; a week when backups are made by hand.
func BackupMaxAge(p *project.Project) time.Duration {
	if schedule.Available() {
		crontab, err := schedule.Read()
		if err == nil && (schedule.On(crontab, p.Root) || len(schedule.HandWritten(crontab, p.Root)) > 0) {
			return 48 * time.Hour
		}
	}
	return 7 * 24 * time.Hour
}

// Schedule says whether cron runs the backups and the hourly check: yellow when it doesn't, or when the crontab's
// lines are older than this version of the tool.
func Schedule(p *project.Project) *Line {
	const how = "  (deploy/deploy.sh schedule on)"
	if !schedule.Available() {
		return &Line{Yellow, "Schedule", "off: cron isn't installed"}
	}
	crontab, err := schedule.Read()
	if err != nil {
		return &Line{Yellow, "Schedule", "unknown (can't read the crontab)"}
	}
	switch {
	case schedule.On(crontab, p.Root) && !schedule.Current(crontab, p.Root, schedule.LogFile(backup.Dir(p))):
		return &Line{Yellow, "Schedule", "out of date" + how}
	case schedule.On(crontab, p.Root):
		return &Line{Green, "Schedule", "nightly database, weekly media and restore test, hourly check"}
	case len(schedule.HandWritten(crontab, p.Root)) > 0:
		return &Line{Yellow, "Schedule", "your own crontab lines, no hourly check" + how}
	}
	return &Line{Yellow, "Schedule", "off: no backups run by themselves" + how}
}

// Disk is the fullest of the disks the server's data is on (the checkout, the backups, Docker's): yellow from 80%
// used, red from 90%, where a build or a database dump can fail halfway.
func Disk(p *project.Project) *Line {
	var worst *diskUse
	seen := map[syscall.Fsid]bool{}
	for _, path := range []string{p.Root, backup.Dir(p), DockerDir} {
		var fs syscall.Statfs_t
		if syscall.Statfs(path, &fs) != nil || fs.Blocks == 0 || seen[fs.Fsid] {
			continue
		}
		seen[fs.Fsid] = true
		// Used as `df` counts it: of the space an ordinary user can fill, leaving out root's reserve.
		used := uint64(fs.Blocks) - uint64(fs.Bfree)
		use := diskUse{
			path:    path,
			percent: int((used*100 + used + uint64(fs.Bavail) - 1) / (used + uint64(fs.Bavail))),
			free:    int64(uint64(fs.Bavail) * uint64(fs.Bsize)),
		}
		if worst == nil || use.percent > worst.percent {
			worst = &use
		}
	}
	if worst == nil {
		return &Line{Dim, "Disk", "unknown"}
	}
	text := fmt.Sprintf("%d%% used  (%s free)", worst.percent, backup.Size(worst.free))
	if worst.path != p.Root {
		text += "  on " + worst.path
	}
	switch {
	case worst.percent >= 90:
		return &Line{Red, "Disk", text}
	case worst.percent >= 80:
		return &Line{Yellow, "Disk", text}
	}
	return &Line{Green, "Disk", text}
}

// DockerDir is where Docker keeps images, build cache and volumes, unless the server moved it.
const DockerDir = "/var/lib/docker"

// Free is the space an ordinary user can still fill on the disk that holds path; false when it can't be told.
func Free(path string) (int64, bool) {
	var fs syscall.Statfs_t
	if syscall.Statfs(path, &fs) != nil || fs.Blocks == 0 {
		return 0, false
	}
	return int64(uint64(fs.Bavail) * uint64(fs.Bsize)), true
}

type diskUse struct {
	path    string
	percent int
	free    int64
}

// Pgweb shows an open database browser, with the time it has left.
func Pgweb(s *stack.Stack) *Line {
	b := pgweb.Find(s)
	if b == nil || b.Overdue() {
		return nil
	}
	return &Line{Yellow, "pgweb", fmt.Sprintf("open until %s  (%s left)", b.ClosesAt.Format("15:04"), pgweb.Left(b.ClosesAt))}
}

// Ago says how long ago t was: "5 min ago", "3 h ago", "1 day ago", "4 days ago".
func Ago(t time.Time) string {
	seconds := int(time.Since(t).Seconds())
	switch {
	case seconds < 3600:
		return fmt.Sprintf("%d min ago", seconds/60)
	case seconds < 86400:
		return fmt.Sprintf("%d h ago", seconds/3600)
	case seconds < 172800:
		return "1 day ago"
	default:
		return fmt.Sprintf("%d days ago", seconds/86400)
	}
}

func or(s, def string) string {
	if s == "" {
		return def
	}
	return s
}
