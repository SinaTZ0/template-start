package commands

import (
	"os"
	"path/filepath"

	"deploy/internal/certs"
	"deploy/internal/envfile"
	"deploy/internal/gitrepo"
	"deploy/internal/ports"
	"deploy/internal/project"
	"deploy/internal/stack"
	"deploy/internal/ui"
)

// Setup sets up a new server: it writes .env from the answers and the registry, then does the first build. Outside a
// checkout it clones the repository first and hands over to the clone's own tool.
func (t *Tool) Setup(args []string) error {
	if err := noArgs("setup", args); err != nil {
		return err
	}
	if err := stack.RequireTools(); err != nil {
		return err
	}
	if !t.P.IsCheckout() {
		return t.cloneAndContinue("setup")
	}
	if _, err := os.Stat(t.P.EnvFile()); err == nil {
		return ui.Fail("This server is already set up (.env exists). Use Update instead.")
	}
	if err := ports.CheckFree(); err != nil {
		return err
	}

	/*------ Questions ------*/
	ui.Step("Domains")
	ui.Info("Both need a DNS record pointing at this server.")
	domain, err := envfile.AskDomain("Site domain (e.g. app.example.com)", "")
	if err != nil {
		return err
	}
	errorsDomain, err := envfile.AskDomain("Error viewer domain", "errors."+domain)
	if err != nil {
		return err
	}
	if domain == errorsDomain {
		return ui.Fail("The error viewer needs its own domain.")
	}

	ui.Step("HTTPS certificate")
	choice, err := ui.Choose("Which certificate?", []string{
		"Automatic   Let's Encrypt via Caddy (needs ports 80 and 443 open to the internet)",
		"My own      certificate files you already have",
	})
	if err != nil {
		return err
	}
	tlsMode := "auto"
	if choice == 1 {
		folder, err := ui.Ask("Folder with your certificate files", "", "")
		if err != nil {
			return err
		}
		if err := certs.Install(folder, domain, errorsDomain, t.P.CertDir()); err != nil {
			return err
		}
		tlsMode = "files"
	}

	ui.Step("Backups")
	dir, err := ui.Ask("Folder for backups", "./backups", "")
	if err != nil {
		return err
	}
	dir = project.ExpandHome(dir)

	/*------ Write .env ------*/
	// The answers above go in; Check generates every secret and SENTRY_DSN, and asks for anything else the registry
	// can't fill in. From here on .env exists and Set up is locked: a failed build is retried with Settings → Apply.
	ui.Step("Writing .env")
	example, err := os.ReadFile(t.P.ExampleFile())
	if err != nil {
		return ui.Fail("Can't read .env.production.example: %v", err)
	}
	if err := os.WriteFile(t.P.EnvFile(), example, 0o600); err != nil {
		return err
	}
	for _, kv := range [][2]string{
		{"DOMAIN", domain}, {"ERRORS_DOMAIN", errorsDomain}, {"TLS_MODE", tlsMode}, {"BACKUP_DIR", dir},
	} {
		if err := envfile.Set(t.P.EnvFile(), kv[0], kv[1]); err != nil {
			return err
		}
	}
	if err := t.Env.Check(""); err != nil {
		return err
	}
	ui.OK(".env written. Keep a copy off the server: it's the only copy of its secrets.")
	review, err := ui.Confirm("Review .env in your editor before the first build?", false)
	if err != nil {
		return err
	}
	if review {
		edited, err := t.Env.Edit()
		if err != nil {
			return err
		}
		if edited {
			if err := t.Env.Check(""); err != nil {
				return err
			}
		}
	}

	// Mirrors, when this server can't reach npm's registry or Go's module proxy: probed rather than asked, since few
	// people know whether their server can.
	ui.Step("Package registries")
	if err := t.checkSources(""); err != nil {
		return err
	}
	if err := t.S.Deploy(t.Env); err != nil {
		return err
	}
	// Starts the deploy steps' ledger: the steps there are now are marked done, since Seed loads their changes.
	if err := t.afterDeploy(); err != nil {
		return err
	}

	/*------ Done ------*/
	env := t.P.EnvFile()
	ui.Step("Done")
	ui.Info("  Site          https://%s", envfile.Get(env, "DOMAIN"))
	ui.Info("  Error viewer  https://%s   password: %s (also in .env)", envfile.Get(env, "ERRORS_DOMAIN"),
		envfile.Get(env, "ERROR_VIEWER_ADMIN_PASSWORD"))
	ui.Info("")
	ui.Info("  The first admin: sign up on the site, then choose Make admin (or: deploy/deploy.sh admin <email>).")

	if err := t.offerSchedule(); err != nil {
		return err
	}
	ui.Info("  The backups are on this server's disk only. For copies somewhere else: deploy/deploy.sh offsite")
	return nil
}

// offerSchedule ends Set up and Recover: cron's jobs belong to the server, so a new one has none. A server nobody
// scheduled has no backups at all, so it's offered here rather than left to the manual.
func (t *Tool) offerSchedule() error {
	ui.Step("Backups by themselves")
	ui.Info("Cron can back up the database every night and the media every Friday, and check the server every hour.")
	scheduled, err := ui.Confirm("Schedule them now?", true)
	if err != nil {
		return err
	}
	if scheduled {
		// The server is set up either way: one without cron gets the reason, and `schedule on` for later.
		if err := t.Schedule([]string{"on"}); err != nil {
			ui.PrintError(err)
		}
	} else {
		ui.Info("  Later: deploy/deploy.sh schedule on")
	}
	return nil
}

// cloneAndContinue clones the project, for the tool run on its own outside a checkout, then hands over to the clone's
// own tool with command (setup or recover). A repository this server can't read (a private one) gets a deploy key
// first.
func (t *Tool) cloneAndContinue(command string) error {
	ui.Info("There's no project here yet, so it's cloned first.")
	url, err := ui.Ask("Git URL of the repository", t.Repository, "")
	if err != nil {
		return err
	}
	if url == "" {
		return ui.Fail("No URL given.")
	}
	wd, _ := os.Getwd()
	target, err := ui.Ask("Folder to clone into", filepath.Join(wd, "app"), "")
	if err != nil {
		return err
	}
	target = project.ExpandHome(target)
	if _, err := os.Stat(target); err == nil {
		return ui.Fail("%s already exists. Run %s/deploy/deploy.sh, or pick another folder.", target, target)
	}

	/*------ Access ------*/
	sshCommand := ""
	if ok, reason := gitrepo.CanRead(url, ""); !ok {
		if url, sshCommand, err = t.deployKeyAccess(url, reason); err != nil {
			return err
		}
	}

	/*------ Clone ------*/
	if err := gitrepo.Clone(url, target, sshCommand); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(target, "deploy", "deploy.sh")); err != nil {
		return ui.Fail("The repository has no deploy/deploy.sh.")
	}
	return execTool(target, command)
}
