package stack

import (
	"bytes"
	"io"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"deploy/internal/envfile"
	"deploy/internal/gitrepo"
	"deploy/internal/interrupt"
	"deploy/internal/ui"
)

var (
	goProxyBlocked = regexp.MustCompile(`proxy\.golang\.org.*403 Forbidden`)
	npmBlocked     = regexp.MustCompile(`registry\.npmjs\.org.*(ETIMEDOUT|ECONNRESET|UND_ERR_SOCKET|timed out|other side closed)`)
	diskFull       = regexp.MustCompile(`no space left on device`)
)

// BuildCacheKeep is how much of the build cache a deploy leaves behind, least recently used removed first. The pnpm
// store and the dependency layers are used by every build, so they're what stays and the next build stays quick.
const BuildCacheKeep = "3GB"

// Deploy builds the images and starts the stack. A running, healthy app is replaced without downtime (RolloutApp);
// otherwise (the first deploy, or an app that's down anyway) Compose starts everything at once. Either way `migrate`
// and `storage-init` run before the new app starts, and a failed build or migration leaves the running app and the
// database as they were. Always a build: SENTRY_DSN is a build argument of the browser bundle, so an .env change can
// need a new image.
func (s *Stack) Deploy(env *envfile.Settings) error {
	// Docker would create a missing bind-mount folder as root, which the tool then couldn't write certificates into.
	if err := os.MkdirAll(s.Root+"/certs", 0o755); err != nil {
		return err
	}
	fingerprint := env.Fingerprint()
	rolling := s.State("app") == "healthy"

	/*------ Build ------*/
	ui.Step("Building")
	var log bytes.Buffer
	build := s.Command(nil, "build")
	build.Stdout = io.MultiWriter(ui.Out, &log)
	build.Stderr = io.MultiWriter(ui.Err, &log)
	if err := interrupt.Check(build.Run()); err != nil {
		if err == interrupt.ErrInterrupted {
			return err
		}
		// Where Google blocks the region, the error viewer's build gets 403 from Go's module proxy (docs/deployment.md).
		if goProxyBlocked.Match(log.Bytes()) {
			return ui.Fail("This server can't download Go modules from proxy.golang.org. Set GOPROXY in .env to a mirror " +
				"it can reach\n(e.g. GOPROXY=https://goproxy.cn): choose Settings, edit .env, then apply (deploy/deploy.sh apply).")
		}
		// The check before the build catches a blocked npm registry; this is for one that fails only now.
		if npmBlocked.Match(log.Bytes()) {
			return ui.Fail("This server can't download npm packages from registry.npmjs.org. Set NPM_REGISTRY in .env to a " +
				"mirror it can reach\n(e.g. NPM_REGISTRY=https://registry.npmmirror.com): choose Settings, edit .env, then " +
				"apply (deploy/deploy.sh apply).")
		}
		if diskFull.Match(log.Bytes()) {
			return ui.Fail("The server's disk is full. Nothing that was running was replaced. Free space with\n" +
				"  docker builder prune -f && docker image prune -f\n(check with deploy/deploy.sh status), then choose " +
				"Settings → Apply (deploy/deploy.sh apply).")
		}
		return ui.Fail("The build failed (see above). Nothing that was running was replaced. Once it's fixed, choose " +
			"Settings → Apply\n(deploy/deploy.sh apply).")
	}
	image, err := s.AppImage()
	if err != nil {
		return err
	}
	if err := DockerQuiet("tag", image, image+":"+gitrepo.Version(s.Root)); err != nil {
		return err
	}

	if rolling {
		/*------ Everything But the App ------*/
		// `--no-deps`, so Compose leaves the app alone: only RolloutApp replaces it.
		ui.Step("Updating the other services")
		others := slices.DeleteFunc(slices.Clone(Services), func(s string) bool { return s == "app" })
		if err := s.Run(append([]string{"up", "-d", "--no-deps", "--remove-orphans"}, others...)...); err != nil {
			return failUnlessStopped(err, "Starting the other services failed (see above). The app that was running still runs.")
		}

		ui.Step("Running migrations")
		if err := s.runJobs(); err != nil {
			return failUnlessStopped(err, "The migration or the bucket setup failed (see above). The app that was running "+
				"still runs, and pending\nmigrations run in one transaction, so the database is as it was. Once it's "+
				"fixed, choose Settings → Apply.")
		}

		if err := s.RolloutApp(); err != nil {
			return failUnlessStopped(err, "Migrations the new version ran stay applied (Update's pre-update dump has the "+
				"database from before them).\nOnce it's fixed, choose Settings → Apply (deploy/deploy.sh apply).")
		}
		if err := env.RecordApplied(fingerprint); err != nil {
			return err
		}
	} else {
		/*------ Everything at Once ------*/
		ui.Step("Starting the stack")
		if err := s.Run("up", "-d", "--remove-orphans"); err != nil {
			return failUnlessStopped(err, "The deploy stopped (see above). A failed migration leaves the database as it "+
				"was. Once it's fixed, choose\nSettings → Apply (deploy/deploy.sh apply).")
		}
		// The containers now run with this .env, even if the app turns out unhealthy below.
		if err := env.RecordApplied(fingerprint); err != nil {
			return err
		}
		if err := ui.Spin("Waiting for the app to turn healthy", func(io.Writer) error {
			return s.WaitHealthy("app", 180*time.Second)
		}); err != nil {
			return failUnlessStopped(err, "The app didn't turn healthy. Its logs: deploy/deploy.sh logs app. Once it's "+
				"fixed, choose Settings → Apply.")
		}
	}
	ui.OK("App is healthy")

	/*------ Caddy and the Error Viewer ------*/
	// Compose recreates Caddy only when its own config changes, not the mounted Caddyfile. A reload applies an edited
	// Caddyfile without dropping connections, and does nothing when it's unchanged.
	if s.State("caddy") == "running" {
		if err := s.ReloadCaddy(false); err != nil {
			ui.Warn("Caddy didn't reload its Caddyfile. Its logs: deploy/deploy.sh logs caddy")
		}
	}
	if err := ui.Spin("Waiting for the error viewer", func(io.Writer) error {
		return s.WaitHealthy("error-viewer", 60*time.Second)
	}); err == nil {
		ui.OK("Error viewer is healthy")
	} else if err == interrupt.ErrInterrupted {
		return err
	} else {
		ui.Warn("The error viewer didn't turn healthy. Its logs: deploy/deploy.sh logs error-viewer")
	}

	s.PruneVersions(image)
	// Each build leaves the previous images behind, untagged; on a small disk they add up. Only this stack's: Compose
	// labels what it builds with the project, and other projects' untagged images on the server aren't ours to remove.
	_ = Docker(nil, "image", "prune", "-f", "--filter", "label=com.docker.compose.project="+s.ProjectName()).Run()
	// The build cache grows by every build's new layers and is never cleared on its own. It's shared by all builds on
	// the server, but trimming only its least recently used part costs another project at most a slower next build.
	_ = DockerQuiet("builder", "prune", "-f", "--keep-storage", BuildCacheKeep)
	return nil
}

// runJobs runs the one-time jobs: migrations, then the bucket setup.
func (s *Stack) runJobs() error {
	if err := s.Run("run", "--rm", "-T", "migrate"); err != nil {
		return err
	}
	return s.Run("run", "--rm", "-T", "storage-init")
}

// failUnlessStopped turns err into a Failure with msg, unless Ctrl-C stopped it.
func failUnlessStopped(err error, msg string) error {
	if err == interrupt.ErrInterrupted {
		return err
	}
	return ui.Fail("%s", msg)
}

// RolloutApp replaces the running app without downtime: a new app container starts beside the old one, and the old one
// stops once the new one is healthy. Caddy proxies to `app`, which Docker's DNS resolves to every running app
// container, so requests reach whichever is up; the old one finishes what it's serving on SIGTERM. A new container that
// doesn't turn healthy is removed and the old one keeps serving (an error). The steps of docker-rollout
// (github.com/wowu/docker-rollout), without installing it.
func (s *Stack) RolloutApp() error {
	out, _ := s.Output("ps", "-q", "app")
	old := strings.Fields(out)

	ui.Step("Starting the new app beside the old one")
	// `--no-recreate` keeps the old container as it is; the larger scale adds one on the new image.
	scale := "app=" + strconv.Itoa(len(old)+1)
	if err := s.Run("up", "-d", "--no-deps", "--no-recreate", "--scale", scale, "app"); err != nil {
		ui.Warn("The new app didn't start (see above). The old one still serves.")
		return err
	}
	out, _ = s.Output("ps", "-q", "app")
	newID := ""
	for _, id := range strings.Fields(out) {
		if !slices.Contains(old, id) {
			newID = id
			break
		}
	}
	if newID == "" {
		ui.Warn("Compose started no new app container. The old one still serves.")
		return errNotHealthy
	}

	if err := ui.Spin("Waiting for the new app to turn healthy", func(io.Writer) error {
		return WaitContainer(newID, 180*time.Second)
	}); err != nil {
		logs := Docker(nil, "logs", "--tail", "30", newID)
		logs.Stdout, logs.Stderr = ui.Err, ui.Err
		_ = logs.Run()
		_ = Docker(nil, "rm", "-f", newID).Run()
		ui.Warn("The new app didn't turn healthy (its last log lines are above), so it was removed: the old one still serves.")
		return err
	}

	ui.Step("Stopping the old app")
	if len(old) > 0 {
		if DockerQuiet(append([]string{"stop"}, old...)...) != nil || DockerQuiet(append([]string{"rm"}, old...)...) != nil {
			ui.Warn("The old app container didn't stop cleanly (see above); the new one serves. Remove the old one:\n  docker rm -f %s",
				strings.Join(old, " "))
		}
	}
	return nil
}
