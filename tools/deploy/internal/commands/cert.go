package commands

import (
	"deploy/internal/certs"
	"deploy/internal/envfile"
	"deploy/internal/ui"
)

// Cert switches to Let's Encrypt (`auto`), or installs your own certificate from a folder.
func (t *Tool) Cert(args []string) error {
	if err := t.requireSetUp(); err != nil {
		return err
	}
	if len(args) > 1 {
		return ui.Usage("cert takes auto or one folder (see deploy/deploy.sh help)")
	}
	env := t.P.EnvFile()
	source := ""
	if len(args) == 1 {
		source = args[0]
	}
	old := or(envfile.Get(env, "TLS_MODE"), "auto")
	domain, errorsDomain := envfile.Get(env, "DOMAIN"), envfile.Get(env, "ERRORS_DOMAIN")

	if source == "" {
		if old == "files" {
			ui.Info("Now: your own certificate (certs/)")
		} else {
			ui.Info("Now: automatic (Let's Encrypt)")
		}
		n, err := ui.Choose("Which certificate?", []string{
			"Automatic   Let's Encrypt via Caddy (needs ports 80 and 443 open to the internet)",
			"My own      certificate files you already have; also to replace an expiring one",
		})
		if err != nil {
			return err
		}
		source = "auto"
		if n == 1 {
			if source, err = ui.Ask("Folder with your certificate files", "", ""); err != nil {
				return err
			}
		}
	}

	// Only Caddy reads TLS_MODE, and applyTLS restarts it. So when nothing else was pending, nothing is afterwards.
	state := t.Env.State()
	mode := "auto"
	if source != "auto" {
		if err := certs.Install(source, domain, errorsDomain, t.P.CertDir()); err != nil {
			return err
		}
		mode = "files"
	}
	if err := envfile.Set(env, "TLS_MODE", mode); err != nil {
		return err
	}
	if err := t.applyTLS(old); err != nil {
		return err
	}
	if state == envfile.Applied {
		return t.Env.RecordApplied("")
	}
	return nil
}

// applyTLS restarts Caddy when TLS_MODE changed (it's an environment variable), and reloads it otherwise. `--force`,
// since the Caddyfile is the same and only the certificate files changed.
func (t *Tool) applyTLS(old string) error {
	mode := envfile.Get(t.P.EnvFile(), "TLS_MODE")
	if t.S.State("caddy") == "running" && old == mode {
		ui.Step("Reloading Caddy")
		if err := t.S.Run("exec", "-T", "caddy", "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--force"); err != nil {
			return ui.Fail("Caddy didn't reload (see above). Its logs: deploy/deploy.sh logs caddy")
		}
	} else {
		ui.Step("Restarting Caddy with TLS_MODE=%s", mode)
		if err := t.S.Run("up", "-d", "--no-deps", "caddy"); err != nil {
			return ui.Fail("Caddy didn't start (see above). Its logs: deploy/deploy.sh logs caddy")
		}
	}
	if mode == "files" {
		ui.OK("Caddy is using the certificate in certs/")
	} else {
		ui.OK("Caddy is using the automatic certificates")
	}
	return nil
}
