package commands

import (
	"fmt"
	"io"
	"slices"
	"strings"
	"time"

	"deploy/internal/backup"
	"deploy/internal/envfile"
	"deploy/internal/gitrepo"
	"deploy/internal/stack"
	"deploy/internal/ui"
)

// Rollback runs a kept older image of the app. Only the app goes back: the checkout, .env, the other services and the
// database stay as they are, so the next Update or Apply deploys the checkout again.
func (t *Tool) Rollback(args []string) error {
	if len(args) > 1 {
		return ui.Usage("rollback takes one version at most (see deploy/deploy.sh help)")
	}
	if err := t.requireSetUp(); err != nil {
		return err
	}
	if err := stack.RequireTools(); err != nil {
		return err
	}
	version := ""
	if len(args) == 1 {
		version = args[0]
	}
	image, err := t.S.AppImage()
	if err != nil {
		return ui.Fail("Compose can't read the stack's config (docker compose config failed).")
	}
	current := t.S.RunningVersion()
	head := gitrepo.Version(t.P.Root)
	var kept, labels []string
	for _, v := range stack.ListVersions(image) {
		if v.Tag == current {
			continue
		}
		kept = append(kept, v.Tag)
		labels = append(labels, fmt.Sprintf("%-9s %-12s %s", v.Tag, v.Built, truncate(gitrepo.Subject(t.P.Root, v.Tag), 60)))
	}
	if len(kept) == 0 {
		return ui.Fail("No other version is kept to roll back to. Each deploy keeps its own (the newest %d).",
			stack.KeepVersions)
	}

	/*------ Pick ------*/
	if version == "" {
		if !ui.Interactive {
			return ui.Fail("Pass the version: deploy/deploy.sh rollback <version>. Kept: %s", join(kept))
		}
		ui.Info("Running: %s", or(current, "unknown"))
		n, err := ui.Choose("Roll back to which version? (newest first)", labels)
		if err != nil {
			return err
		}
		version = kept[n]
	}
	if version == current {
		return ui.Fail("The app already runs %s.", version)
	}
	if !slices.Contains(kept, version) || stack.ImageID(image+":"+version) == "" {
		return ui.Fail("No kept version %s. Kept: %s", version, join(kept))
	}
	if version == head {
		ui.Info("%s is the checkout's version: this undoes a roll back.", version)
	} else {
		ui.Warn("Only the app goes back to %s. The checkout stays at %s: the next Update or Apply deploys that again.",
			version, head)
	}
	ok, err := ui.Confirm(fmt.Sprintf("Switch the app to %s?", version), true)
	if err != nil {
		return err
	}
	if !ok {
		return ui.Fail("Nothing was changed.")
	}

	/*------ Replace ------*/
	// `latest` is what Compose runs. A healthy app is replaced without downtime; a broken one is simply recreated.
	previous := stack.ImageID(image)
	if err := stack.DockerQuiet("tag", image+":"+version, image); err != nil {
		return err
	}
	if t.S.State("app") == "healthy" {
		if err := t.S.RolloutApp(); err != nil {
			_ = stack.DockerQuiet("tag", previous, image)
			return ui.Fail("Nothing was changed: the app still runs %s.", or(current, "the version it ran"))
		}
	} else {
		ui.Step("Recreating the app on %s", version)
		if err := t.S.Run("up", "-d", "--no-deps", "--force-recreate", "app"); err != nil {
			return err
		}
		if err := ui.Spin("Waiting for the app to turn healthy", func(io.Writer) error {
			return t.S.WaitHealthy("app", 180*time.Second)
		}); err != nil {
			return ui.Fail("The app didn't turn healthy on %s either. Its logs: deploy/deploy.sh logs app", version)
		}
	}
	ui.OK("The app runs %s.", version)

	// Back on the checkout's version, the database already fits it.
	if version != head {
		return t.offerPreUpdateRestore(image, version)
	}
	return nil
}

// offerPreUpdateRestore offers the database from before version was replaced. The old version runs on the database as
// the newer one's migrations left it. That works as long as they only added things; when it doesn't, the dump Update
// took before replacing this version has the database from back then: the oldest pre-update dump newer than the
// version's image.
func (t *Tool) offerPreUpdateRestore(image, version string) error {
	created, err := stack.DockerOutput("image", "inspect", "-f", "{{.Created}}", image+":"+version)
	if err != nil {
		return nil
	}
	built, err := time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return nil
	}
	dump := ""
	for _, f := range backup.List(backup.Dir(t.P)) {
		if strings.HasSuffix(f.Name(), "-pre-update.dump") && f.Modified.After(built) {
			dump = f.Path
		}
	}
	if dump == "" {
		return nil
	}
	ui.Info("")
	ui.Info("The database stays as the newer version left it. If %s fails on it (a column it needs was dropped or", version)
	ui.Info("renamed), restore %s, the dump taken when %s was replaced.", dump[strings.LastIndex(dump, "/")+1:], version)
	ui.Info("What was written since is lost.")
	if ui.Interactive {
		ok, err := ui.Confirm("Restore it now?", false)
		if err != nil {
			return err
		}
		if ok {
			return t.Restore([]string{dump})
		}
	}
	ui.Info("Later: deploy/deploy.sh restore %s --confirm %s", dump, envfile.Get(t.P.EnvFile(), "DOMAIN"))
	return nil
}

func or(s, def string) string {
	if s == "" {
		return def
	}
	return s
}
