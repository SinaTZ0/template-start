package envfile

import (
	"fmt"
	"os"
	"regexp"
	"slices"
	"strings"

	"deploy/internal/settings"
	"deploy/internal/ui"
)

var identifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// Check brings .env in line with the registry before a deploy: it tidies it, appends keys new in the example, fills in
// what can be generated and asks for the rest (here, or in the editor). Without a terminal it stops instead of asking
// and names each key; note, when set, is added to that message.
func (s *Settings) Check(note string) error {
	if f, err := os.OpenFile(s.Env, os.O_WRONLY, 0); err != nil {
		return ui.Fail("Can't write to .env. Fix its owner: sudo chown %d %s", os.Getuid(), s.Env)
	} else {
		f.Close()
	}
	if err := os.Chmod(s.Env, 0o600); err != nil {
		ui.Warn("Can't make .env private (chmod 600): its owner is another user.")
	}
	if err := s.tidy(); err != nil {
		return err
	}
	if err := s.appendNewKeys(); err != nil {
		return err
	}

	warned, keyGenerated := false, false
	for {
		/*------ Fill In ------*/
		ex := ReadExample(s.Example)
		var generated, defaults []string
		for _, p := range only(s.Problems(s.Env), settings.Gen) {
			if err := Set(s.Env, p.Key, settings.Generate(p.Key, ex.Values)); err != nil {
				return err
			}
			if settings.IsSecretKey(p.Key) {
				generated = append(generated, p.Key)
			} else {
				defaults = append(defaults, p.Key+"="+ex.Values[p.Key])
			}
			if p.Key == "ERROR_VIEWER_PUBLIC_KEY" {
				keyGenerated = true
			}
		}
		if len(generated) > 0 {
			ui.OK("Generated %s", JoinComma(generated))
		}
		if len(defaults) > 0 {
			ui.OK("Set to the example's defaults: %s", JoinComma(defaults))
		}
		if err := s.syncDSN(keyGenerated); err != nil {
			return err
		}

		/*------ Report ------*/
		problems := s.Problems(s.Env)
		if !warned {
			warned = true
			for _, p := range only(problems, settings.Warn) {
				if p.Key != "SENTRY_DSN" {
					ui.Warn("%s %s.", p.Key, p.Reason)
				}
			}
		}
		asks := only(problems, settings.Ask)
		if len(asks) == 0 {
			ui.OK(".env has every setting.")
			return nil
		}
		ui.Warn("These settings need a value:")
		PrintProblems(asks)
		if !ui.Interactive {
			msg := fmt.Sprintf("Can't deploy until .env is fixed: %s. Set the values in .env (or run deploy/deploy.sh env "+
				"on a terminal), then deploy/deploy.sh apply.", JoinComma(keysOf(asks)))
			if note != "" {
				msg += "\n" + note
			}
			return ui.Fail("%s", msg)
		}

		/*------ Ask ------*/
		// Only keys can be answered here; a line Compose can't parse needs the editor.
		var answerable []string
		for _, key := range keysOf(asks) {
			if identifier.MatchString(key) {
				answerable = append(answerable, key)
			}
		}
		var options []string
		if len(answerable) > 0 {
			options = append(options, "Answer here")
		}
		options = append(options, "Open .env in your editor", "Stop")
		n, err := ui.Choose("How do you want to set them?", options)
		if err != nil {
			return err
		}
		switch options[n] {
		case "Answer here":
			for _, key := range answerable {
				if err := s.answer(key); err != nil {
					return err
				}
			}
		case "Open .env in your editor":
			if _, err := s.Edit(); err != nil {
				return err
			}
		default:
			msg := "Stopped. .env still needs a value for the settings above."
			if note != "" {
				msg += " " + note
			}
			return ui.Fail("%s", msg)
		}
	}
}

// CheckOnly reports what Check would fill in or ask for, and changes nothing: for cron and CI. It fails when .env
// isn't ready.
func (s *Settings) CheckOnly() error {
	content := Read(s.Env)
	if Normalize(content, true) != content {
		ui.Info("• .env isn't tidy (line endings, spacing, export, quotes or duplicates); the next apply tidies it.")
	}
	bad := false
	for _, p := range s.Problems(s.Env) {
		switch p.Fix {
		case settings.Ask, settings.Gen:
			fmt.Fprintf(ui.Out, "%s %-30s %s\n", ui.Red("✗"), p.Key, p.Reason)
			bad = true
		case settings.Warn:
			ui.Warn("%s %s.", p.Key, p.Reason)
		}
	}
	if bad {
		return ui.Fail(".env isn't ready. deploy/deploy.sh env fills in or asks for these; deploy/deploy.sh apply does " +
			"too, then deploys.")
	}
	ui.OK(".env has every setting.")
	return nil
}

// tidy rewrites .env as Normalize does, after a confirm when that drops duplicates.
func (s *Settings) tidy() error {
	content := Read(s.Env)
	tidy := Normalize(content, true)
	if tidy == content {
		return nil
	}
	dups := Duplicates(content)
	if len(dups) > 0 {
		ui.Warn("Set more than once in .env: %s. The last line counts, for Compose too.", strings.Join(dups, " "))
		if ui.Interactive {
			ok, err := ui.Confirm("Remove the earlier lines?", true)
			if err != nil {
				return err
			}
			if !ok {
				return ui.Fail("Left .env as it was. Remove the lines you don't want, then run this again.")
			}
		}
	}
	if err := os.WriteFile(s.Env, []byte(tidy), 0o600); err != nil {
		return err
	}
	what := "line endings, spacing, export, quotes"
	if len(dups) > 0 {
		what += ", duplicates"
	}
	ui.OK("Tidied .env (%s)", what)
	return nil
}

// appendNewKeys appends the example's keys that .env doesn't have, each with the comment block above it in the example.
func (s *Settings) appendNewKeys() error {
	added, keys := NewKeys(Read(s.Env), Read(s.Example))
	if len(keys) == 0 {
		return nil
	}
	f, err := os.OpenFile(s.Env, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.WriteString(added); err != nil {
		return err
	}
	ui.Info("Added from .env.production.example: %s", strings.Join(keys, ", "))
	return nil
}

// syncDSN points SENTRY_DSN at this server's error viewer: always when the key was just generated, else after asking.
func (s *Settings) syncDSN(keyGenerated bool) error {
	values := Parse(Read(s.Env))
	expected := settings.ExpectedDSN(values)
	dsn := values["SENTRY_DSN"]
	if expected == "" || dsn == expected || expected == s.dsnRaised {
		return nil
	}
	if keyGenerated {
		if err := Set(s.Env, "SENTRY_DSN", expected); err != nil {
			return err
		}
		ui.OK("SENTRY_DSN points at this server's error viewer.")
		return nil
	}
	s.dsnRaised = expected
	if dsn == "" {
		ui.Warn("SENTRY_DSN is empty, so error reporting is off.")
		return nil
	}
	ui.Warn("SENTRY_DSN doesn't point at this server's error viewer (https://<ERROR_VIEWER_PUBLIC_KEY>@<ERRORS_DOMAIN>/1).")
	if !ui.Interactive {
		return nil
	}
	ok, err := ui.Confirm("Point it there?", true)
	if err != nil || !ok {
		return err
	}
	if err := Set(s.Env, "SENTRY_DSN", expected); err != nil {
		return err
	}
	ui.OK("SENTRY_DSN updated.")
	return nil
}

// AskDomain asks until the answer is a domain name, and not the example's placeholder.
func AskDomain(question, def string) (string, error) {
	for {
		domain, err := ui.Ask(question, def, "")
		if err != nil {
			return "", err
		}
		domain = strings.ToLower(domain)
		switch {
		case !settings.DomainRE.MatchString(domain):
			ui.Warn("%q isn't a domain name like app.example.com.", domain)
		case settings.IsPlaceholderDomain(domain):
			ui.Warn("%s is the example's placeholder. Use your own domain.", domain)
		default:
			return domain, nil
		}
	}
}

// answer asks for one setting, in the way its kind needs, until the answer passes its check.
func (s *Settings) answer(key string) error {
	kind := settings.KindOf(key)
	explained := false
	for {
		ex := ReadExample(s.Example)
		values := Parse(Read(s.Env))
		var value string
		var err error
		switch {
		case kind == "domain" && key == "ERRORS_DOMAIN":
			def := ""
			if settings.DomainRE.MatchString(values["DOMAIN"]) {
				def = "errors." + values["DOMAIN"]
			}
			value, err = AskDomain("Error viewer domain (ERRORS_DOMAIN)", def)
		case kind == "domain":
			value, err = AskDomain(fmt.Sprintf("Site domain (%s, e.g. app.example.com)", key), "")
		case strings.HasPrefix(kind, "enum:"):
			options := strings.Split(kind[5:], ",")
			var n int
			n, err = ui.Choose(key+":", options)
			value = options[n]
		case settings.Generated(kind) && key == "POSTGRES_PASSWORD" && s.PgdataExists != nil && s.PgdataExists():
			if !explained {
				ui.Info("The database already exists, and Postgres only reads POSTGRES_PASSWORD when it creates it: a new")
				ui.Info("password would lock the app out. Enter the original one (from your copy of .env).")
				explained = true
			}
			value, err = ui.AskSecret("Original POSTGRES_PASSWORD")
		case settings.Generated(kind):
			value, err = ui.AskSecret(key + " (Enter to generate one)")
			if value == "" {
				value = settings.Generate(key, ex.Values)
			}
		case kind == "derived":
			value, err = ui.Ask(key, settings.ExpectedDSN(values), "")
		case settings.IsSecretKey(key):
			value, err = ui.AskSecret(key)
		default:
			value, err = ui.Ask(key, ex.Values[key], "")
		}
		if err != nil {
			return err
		}

		check := settings.Checker{Values: values, Example: ex.Values, PgdataExists: s.PgdataExists}
		i := slices.IndexFunc(check.Validate(key, value, true), func(p settings.Problem) bool { return p.Fix == settings.Ask })
		if i < 0 {
			return Set(s.Env, key, value)
		}
		ui.Warn("%s %s.", key, check.Validate(key, value, true)[i].Reason)
	}
}
