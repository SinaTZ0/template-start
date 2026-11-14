package offsite

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// The copy of .env is the only way back to the secrets after a lost server: it has to come back as it went in, and
// only with its password.
func TestEnvRoundTrip(t *testing.T) {
	content := []byte("DOMAIN=app.example.com\nPOSTGRES_PASSWORD=abc123\n")
	encrypted, err := Encrypt(content, "a long enough password")
	if err != nil {
		t.Fatal(err)
	}
	got, err := Decrypt(encrypted, "a long enough password")
	if err != nil || string(got) != string(content) {
		t.Fatalf("Decrypt = %q, %v", got, err)
	}
	if _, err := Decrypt(encrypted, "another password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("wrong password: %v", err)
	}
}

func TestLoad(t *testing.T) {
	env := filepath.Join(t.TempDir(), ".env")
	write := func(content string) {
		if err := os.WriteFile(env, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	write("DOMAIN=app.example.com\nBACKUP_S3_ENDPOINT=\nBACKUP_S3_BUCKET=backups\n")
	if c, err := Load(env); c != nil || err != nil {
		t.Fatalf("no endpoint: %v, %v", c, err)
	}

	write("DOMAIN=app.example.com\nBACKUP_S3_ENDPOINT=https://s3.example.com\nBACKUP_S3_BUCKET=backups\n")
	if _, err := Load(env); err == nil {
		t.Fatal("half set: no error")
	}

	write("DOMAIN=app.example.com\nBACKUP_S3_ENDPOINT=https://s3.example.com/backups\nBACKUP_S3_BUCKET=backups\n" +
		"BACKUP_S3_ACCESS_KEY=a\nBACKUP_S3_SECRET_KEY=b\n")
	if _, err := Load(env); err == nil {
		t.Fatal("bucket in the endpoint: no error")
	}

	write("DOMAIN=app.example.com\nBACKUP_S3_ENDPOINT=https://s3.example.com\nBACKUP_S3_BUCKET=backups\n" +
		"BACKUP_S3_ACCESS_KEY=a\nBACKUP_S3_SECRET_KEY=b\n")
	c, err := Load(env)
	if err != nil || c.Prefix != "app.example.com/" || c.Keep != DefaultKeep {
		t.Fatalf("Load = %+v, %v", c, err)
	}
}
