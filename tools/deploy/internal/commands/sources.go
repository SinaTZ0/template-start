package commands

import (
	"io"

	"deploy/internal/envfile"
	"deploy/internal/sources"
	"deploy/internal/ui"
)

// checkSources runs before each build: for each package source this server can't reach, it offers the source's mirror
// and writes the choice to .env. Without a terminal it stops instead, naming the setting, rather than start a build
// that would hang for minutes; note, when set, is added to that message.
func (t *Tool) checkSources(note string) error {
	env := t.P.EnvFile()
	var blocked []sources.Blocked
	_ = ui.Spin("Checking that this server can reach the package registries", func(io.Writer) error {
		blocked = sources.Check(func(key string) string { return envfile.Get(env, key) })
		return nil
	})
	for _, b := range blocked {
		ui.Warn("%s: %s, so the build can't download %s from it.", b.Name, b.Problem, b.What)
		if !ui.Interactive {
			msg := "Set " + b.Key + "=" + b.Mirror + " in .env (a mirror), or " + b.Key + "=" + b.Default +
				" to build from " + b.Name + " anyway, then apply (deploy/deploy.sh apply)."
			if note != "" {
				msg += "\n" + note
			}
			return ui.Fail("%s", msg)
		}
		use, err := ui.Confirm("Download "+b.What+" from the mirror "+b.Mirror+" instead?", true)
		if err != nil {
			return err
		}
		if !use {
			ui.Warn("Building from %s anyway. To stop this question, set %s=%s in .env.", b.Name, b.Key, b.Default)
			continue
		}
		if err := envfile.Set(env, b.Key, b.Mirror); err != nil {
			return err
		}
		ui.OK("Set %s=%s in .env", b.Key, b.Mirror)
	}
	return nil
}
