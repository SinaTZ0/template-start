// Package settings is the registry of every variable .env can hold, and the checks each one's kind implies. Set up,
// Update and Settings check .env against it before each deploy: they fill in what a kind can generate and ask for the
// rest, so a missing value never first shows up as a failed Compose run.
//
// A new variable in `.env.production.example` needs an entry here, and a required one that can't be generated (a
// domain, an API key, an external URL) needs a kind that asks for it (docs/deployment.md → Adding a Variable). A key in
// the example but not here is asked for, with a warning that the registry misses it.
package settings

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
)

// Scope says who reads a variable: Compose (a change needs an Apply), or only this tool (it never does).
type Scope int

const (
	Stack Scope = iota
	Script
)

// Setting is one registry entry.
//
//	domain        asked for; `example.com` and names under it count as unset
//	required      asked for; anything but empty (a third-party API key)
//	url           asked for; an http(s) URL (an external service)
//	secret:<n>[:<min>]
//	              generated (<n> random bytes, as hex). A value set by hand may only use letters, digits and `-._~`,
//	              since secrets go inside the database URL and the store's JSON config, where `/`, `+`, `@` or quotes
//	              would break them; and needs <min> characters where the app or the viewer refuses fewer
//	password:<n>  generated like a secret; any value of at least <n> characters
//	enum:<a,b,…>  one of these; empty takes the example's value
//	int           a whole number above 0; empty takes the example's value
//	default       anything; empty takes the example's value
//	optional      anything, empty too
//	registry      empty, or an http(s) URL without a trailing slash (an npm registry: the Dockerfile appends the `/`)
//	derived       SENTRY_DSN, from ERROR_VIEWER_PUBLIC_KEY and ERRORS_DOMAIN
type Setting struct {
	Key   string
	Kind  string
	Scope Scope
}

// Registry lists every known variable.
var Registry = []Setting{
	{"DOMAIN", "domain", Stack},
	{"ERRORS_DOMAIN", "domain", Stack},
	{"TLS_MODE", "enum:auto,files", Stack},
	{"BACKUP_DIR", "default", Script},
	{"BACKUP_KEEP", "int", Script},
	{"LOG_LEVEL", "enum:fatal,error,warn,info,debug,trace,silent", Stack},
	{"ERROR_VIEWER_PUBLIC_KEY", "secret:16", Stack},
	{"ERROR_VIEWER_ADMIN_PASSWORD", "password:12", Stack},
	{"ERROR_VIEWER_SESSION_SECRET", "secret:32:32", Stack},
	{"SENTRY_DSN", "derived", Stack},
	{"GOPROXY", "optional", Stack},
	{"NPM_REGISTRY", "registry", Stack},
	{"POSTGRES_PASSWORD", "secret:32", Stack},
	{"BETTER_AUTH_SECRET", "secret:32:32", Stack},
	{"ALTCHA_HMAC_KEY", "secret:32:32", Stack},
	{"S3_BUCKET_NAME", "default", Stack},
	{"S3_ACCESS_KEY", "secret:16", Stack},
	{"S3_SECRET_KEY", "secret:32", Stack},
	{"S3_ADMIN_ACCESS_KEY", "secret:16", Stack},
	{"S3_ADMIN_SECRET_KEY", "secret:32", Stack},
	// Overrides `compose.prod.yaml` reads but the example leaves out; Compose has a default for each.
	{"LOG_SLOW_REQUEST_MS", "int", Stack},
	{"LOG_SLOW_QUERY_MS", "int", Stack},
	{"LOG_QUERY_PARAMS", "optional", Stack},
}

// Lookup finds a key's entry.
func Lookup(key string) (Setting, bool) {
	for _, s := range Registry {
		if s.Key == key {
			return s, true
		}
	}
	return Setting{}, false
}

// KindOf is a key's kind, empty when the registry doesn't know it.
func KindOf(key string) string {
	s, _ := Lookup(key)
	return s.Kind
}

// Generated reports whether the kind is one the tool makes up (secret or password).
func Generated(kind string) bool {
	return strings.HasPrefix(kind, "secret:") || strings.HasPrefix(kind, "password:")
}

var secretName = regexp.MustCompile(`(SECRET|PASSWORD|KEY|TOKEN)$`)

// IsSecretKey reports whether a key's value is never printed: the generated kinds, and any name like an API key's.
func IsSecretKey(key string) bool { return Generated(KindOf(key)) || secretName.MatchString(key) }

// Secret returns n random bytes as hex. Hex only: secrets go inside the database URL and the store's JSON config,
// where `/`, `+`, `@` or quotes would break them.
func Secret(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// Generate is the value filled in for a missing key: a new secret for the generated kinds, else the example's value.
func Generate(key string, example map[string]string) string {
	kind := KindOf(key)
	if Generated(kind) {
		n, _ := strconv.Atoi(strings.SplitN(kind, ":", 3)[1])
		return Secret(n)
	}
	return example[key]
}
