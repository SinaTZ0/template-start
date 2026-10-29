package envfile

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"deploy/internal/settings"
)

func TestNormalize(t *testing.T) {
	in := "# comment\r\nexport A = 1 \r\nB=\"quoted\"\nC='keeps $dollar'\nD=plain # note\nE=\"x\" # note\nA=2\n"
	want := "# comment\nB=quoted\nC='keeps $dollar'\nD=plain\nE=x\nA=2\n"
	if got := Normalize(in, true); got != want {
		t.Errorf("Normalize:\n got %q\nwant %q", got, want)
	}
	if got := Duplicates(in); !slices.Equal(got, []string{"A"}) {
		t.Errorf("Duplicates = %v", got)
	}
	if got := Unparseable("A=1\nnot a setting\n# fine\n"); !slices.Equal(got, []int{2}) {
		t.Errorf("Unparseable = %v", got)
	}
}

func TestNewKeysKeepsTheirComments(t *testing.T) {
	example := "# Site\nDOMAIN=example.com\n\n# Storage\n# two lines\nS3_A=\nS3_B=\n\n# Feed\nFEED=30\n"
	added, keys := NewKeys("DOMAIN=app.test\nS3_A=x\n", example)
	if want := "\n# Storage\n# two lines\nS3_B=\n\n# Feed\nFEED=30\n"; added != want {
		t.Errorf("added:\n got %q\nwant %q", added, want)
	}
	if !slices.Equal(keys, []string{"S3_B", "FEED"}) {
		t.Errorf("keys = %v", keys)
	}
}

// The fingerprint decides whether the Settings line says an edit is waiting: only what Compose reads may count.
func TestFingerprintIgnoresLayoutAndScriptSettings(t *testing.T) {
	keys := StackKeys(Example{})
	base := Fingerprint("DOMAIN=app.test\nLOG_LEVEL=info\nBACKUP_KEEP=14\n", keys)
	same := Fingerprint("# a comment\nLOG_LEVEL=\"info\"\nexport DOMAIN=app.test\nBACKUP_KEEP=3\n", keys)
	if base != same {
		t.Error("comments, order, quotes and script-only settings changed the fingerprint")
	}
	if base == Fingerprint("DOMAIN=app.test\nLOG_LEVEL=debug\n", keys) {
		t.Error("a changed stack setting kept the fingerprint")
	}
}

// A database that exists keeps the password it was created with: a generated one would lock the app out.
func TestPostgresPasswordIsAskedForOnceTheDatabaseExists(t *testing.T) {
	dir := t.TempDir()
	env, example := filepath.Join(dir, ".env"), filepath.Join(dir, ".env.example")
	if err := os.WriteFile(example, []byte("POSTGRES_PASSWORD=\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(env, []byte("POSTGRES_PASSWORD=\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for exists, want := range map[bool]settings.Fix{false: settings.Gen, true: settings.Ask} {
		s := &Settings{Env: env, Example: example, PgdataExists: func() bool { return exists }}
		problems := s.Problems(env)
		if len(problems) != 1 || problems[0].Fix != want {
			t.Errorf("database exists=%v: problems = %+v, want one %s", exists, problems, want)
		}
	}
}

func TestSetReplacesOrAppends(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte("A=1\nB=2"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Set(path, "A", "x"); err != nil {
		t.Fatal(err)
	}
	if err := Set(path, "C", "3"); err != nil {
		t.Fatal(err)
	}
	if got := Read(path); got != "A=x\nB=2\nC=3\n" {
		t.Errorf("file = %q", got)
	}
	if got := Get(path, "C"); got != "3" {
		t.Errorf("Get = %q", got)
	}
}
