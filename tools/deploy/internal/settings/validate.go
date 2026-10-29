package settings

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// Fix is what the check does about a problem: fill it in without asking, ask for a value, or only say it.
type Fix string

const (
	Gen  Fix = "gen"
	Ask  Fix = "ask"
	Warn Fix = "warn"
)

// State is how a problem shows in the Settings status line.
type State string

const (
	Missing State = "missing"
	Invalid State = "invalid"
	Warning State = "warn"
)

// Problem is one thing wrong with a variable, or with a line of .env. Reasons never contain a secret's value.
type Problem struct {
	Key    string
	Fix    Fix
	State  State
	Reason string
}

var (
	// DomainRE is a lowercase domain name with at least two labels.
	DomainRE    = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$`)
	secretChars = regexp.MustCompile(`^[A-Za-z0-9._~-]+$`)
	keyChars    = regexp.MustCompile(`^[A-Za-z0-9_]+$`)
	wholeNumber = regexp.MustCompile(`^[1-9][0-9]*$`)
	bucketName  = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
	httpURL     = regexp.MustCompile(`^https?://[^/]+`)
	dsnShape    = regexp.MustCompile(`^https?://[^/@]+@[^/]+/[0-9]+$`)
	// Compose expands `$` and treats quotes, `#` and spaces specially, so a stack value with them isn't what it looks
	// like.
	unsafeChars = regexp.MustCompile("[[:space:]$\"'`#\\\\]")
)

// IsPlaceholderDomain reports whether a domain is `example.com` or under it: reserved for examples (RFC 2606), so the
// example file's values mean unset.
func IsPlaceholderDomain(domain string) bool {
	return domain == "example.com" || strings.HasSuffix(domain, ".example.com")
}

// Checker validates values. Values holds .env as Compose reads it, for the checks that compare variables; Example holds
// the example's values, the defaults. PgdataExists reports whether the database volume exists, which decides whether
// an empty POSTGRES_PASSWORD may be generated.
type Checker struct {
	Values       map[string]string
	Example      map[string]string
	PgdataExists func() bool
}

// ExpectedDSN is https://<ERROR_VIEWER_PUBLIC_KEY>@<ERRORS_DOMAIN>/1, or empty while either isn't set yet.
func ExpectedDSN(values map[string]string) string {
	key, domain := values["ERROR_VIEWER_PUBLIC_KEY"], values["ERRORS_DOMAIN"]
	if keyChars.MatchString(key) && DomainRE.MatchString(domain) && !IsPlaceholderDomain(domain) {
		return fmt.Sprintf("https://%s@%s/1", key, domain)
	}
	return ""
}

// Validate checks one variable. inExample says whether .env.production.example has the key.
func (c Checker) Validate(key, value string, inExample bool) []Problem {
	p := func(fix Fix, state State, reason string) []Problem {
		return []Problem{{Key: key, Fix: fix, State: state, Reason: reason}}
	}
	setting, known := Lookup(key)
	kind := setting.Kind

	if value != "" && (!known || setting.Scope == Stack) && unsafeChars.MatchString(value) {
		return p(Ask, Invalid, "has a space, quote, $, # or backslash, which Compose reads differently")
	}

	switch {
	case kind == "domain":
		switch {
		case value == "" || IsPlaceholderDomain(value):
			return p(Ask, Missing, "not set")
		case !DomainRE.MatchString(value):
			return p(Ask, Invalid, "isn't a lowercase domain name like app.example.com")
		case key == "ERRORS_DOMAIN" && value == c.Values["DOMAIN"]:
			return p(Ask, Invalid, "is the same as DOMAIN: the error viewer needs its own")
		}

	case Generated(kind):
		// secret:<n>:<min> → min; password:<n> → n; secret:<n> → no minimum.
		parts := strings.Split(kind, ":")
		minLen := 0
		if parts[0] == "password" || len(parts) == 3 {
			fmt.Sscan(parts[len(parts)-1], &minLen)
		}
		switch {
		case value == "":
			if key == "POSTGRES_PASSWORD" && c.PgdataExists != nil && c.PgdataExists() {
				return p(Ask, Missing, "empty, and the database already exists: it needs the password it was created with")
			}
			return p(Gen, Missing, "empty (generated when applied)")
		case parts[0] == "secret" && !secretChars.MatchString(value):
			return p(Ask, Invalid, "has characters that break the database URL or the store's config (use openssl rand -hex 32)")
		case key == "ERROR_VIEWER_PUBLIC_KEY" && !keyChars.MatchString(value):
			return p(Ask, Invalid, "may only use letters, digits and _ (the Sentry SDKs drop the DSN otherwise)")
		case utf8.RuneCountInString(value) < minLen:
			return p(Ask, Invalid, fmt.Sprintf("is shorter than %d characters", minLen))
		}

	case strings.HasPrefix(kind, "enum:") || kind == "int" || kind == "default":
		switch {
		case value == "":
			// Without a default in the example, Compose's own applies.
			if def := c.Example[key]; def != "" {
				return p(Gen, Missing, fmt.Sprintf("empty (%q, the example's, when applied)", def))
			}
		case strings.HasPrefix(kind, "enum:") && !slices.Contains(strings.Split(kind[5:], ","), value):
			return p(Ask, Invalid, "isn't one of "+strings.ReplaceAll(kind[5:], ",", ", "))
		case kind == "int" && !wholeNumber.MatchString(value):
			return p(Ask, Invalid, "isn't a whole number above 0")
		case key == "S3_BUCKET_NAME" && !bucketName.MatchString(value):
			return p(Ask, Invalid, "isn't a bucket name (3 to 63 lowercase letters, digits, dots and dashes)")
		}

	case kind == "required":
		if value == "" {
			return p(Ask, Missing, "not set")
		}

	case kind == "url":
		if value == "" {
			return p(Ask, Missing, "not set")
		}
		if !httpURL.MatchString(value) {
			return p(Ask, Invalid, "isn't an http:// or https:// URL")
		}

	case kind == "optional":

	case kind == "registry":
		switch {
		case value == "":
		case !httpURL.MatchString(value):
			return p(Ask, Invalid, "isn't an http:// or https:// URL")
		case strings.HasSuffix(value, "/"):
			return p(Ask, Invalid, "ends with a /: leave it off (https://registry.npmmirror.com)")
		}

	case kind == "derived":
		expected := ExpectedDSN(c.Values)
		switch {
		case value == "":
			return p(Warn, Warning, "is empty, so error reporting is off")
		case !dsnShape.MatchString(value):
			return p(Ask, Invalid, "isn't a DSN like https://<key>@<errors domain>/1")
		case expected != "" && value != expected:
			return p(Warn, Warning, "doesn't point at this server's error viewer")
		}

	case !known:
		if inExample {
			problems := p(Warn, Warning, "is in .env.production.example but not in the deploy tool's settings registry")
			if value == "" {
				problems = append(problems, Problem{key, Ask, Missing, "not set"})
			}
			return problems
		}
		if !strings.HasPrefix(key, "COMPOSE_") {
			return p(Warn, Warning, "isn't a known setting (a typo?)")
		}

	default:
		return p(Warn, Warning, fmt.Sprintf("has an unknown kind (%s) in the deploy tool's settings registry", kind))
	}
	return nil
}
