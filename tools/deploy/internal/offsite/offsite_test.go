package offsite

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
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

// A store that holds two sites' folders and one encrypted .env, enough of S3 for what Recover asks it: which sites
// are there, and the copy of .env, with the right password, a wrong one, and for a site that has none.
func TestRecoverReadsTheBucket(t *testing.T) {
	encrypted, err := Encrypt([]byte("DOMAIN=app.example.com\n"), "correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	store := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/backups/" && r.URL.Query().Get("delimiter") == "/":
			w.Header().Set("Content-Type", "application/xml")
			fmt.Fprint(w, `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>backups</Name>`+
				`<IsTruncated>false</IsTruncated><Contents><Key>stray-file</Key><Size>1</Size></Contents>`+
				`<CommonPrefixes><Prefix>shop.example.com/</Prefix></CommonPrefixes>`+
				`<CommonPrefixes><Prefix>app.example.com/</Prefix></CommonPrefixes></ListBucketResult>`)
		case r.URL.Path == "/backups/app.example.com/env.age":
			w.Header().Set("Last-Modified", "Mon, 02 Nov 2026 03:00:00 GMT")
			w.Header().Set("ETag", `"0123456789abcdef0123456789abcdef"`)
			w.Header().Set("Content-Length", fmt.Sprint(len(encrypted)))
			if r.Method == http.MethodGet {
				w.Write(encrypted)
			}
		default:
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>gone</Message></Error>`)
		}
	}))
	defer store.Close()
	config := &Config{Endpoint: store.URL, Bucket: "backups", Region: "us-east-1", AccessKey: "key", SecretKey: "secret"}
	ctx := context.Background()

	sites, err := config.Sites(ctx)
	if err != nil || !slices.Equal(sites, []string{"app.example.com", "shop.example.com"}) {
		t.Fatalf("Sites = %v, %v", sites, err)
	}

	config.Prefix = "app.example.com/"
	content, err := config.FetchEnv(ctx, "correct horse battery")
	if err != nil || string(content) != "DOMAIN=app.example.com\n" {
		t.Fatalf("FetchEnv = %q, %v", content, err)
	}
	if _, err := config.FetchEnv(ctx, "another password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("a wrong password: %v", err)
	}
	config.Prefix = "shop.example.com/"
	if _, err := config.FetchEnv(ctx, "correct horse battery"); !errors.Is(err, ErrNoEnv) {
		t.Fatalf("a site without .env: %v", err)
	}
}
