// Package offsite keeps a copy of the backups away from the server, in an S3-compatible bucket (BACKUP_S3_* in
// .env): a disk that dies, or a server that's deleted, takes the backups in BACKUP_DIR with it. Every object is under
// `<DOMAIN>/`, so several projects can share a bucket:
//
//	<domain>/db-<stamp>.dump, <domain>/media-<stamp>.tar.gz   the backups, as they are on disk
//	<domain>/env.age                                           .env, encrypted with BACKUP_ENV_PASSWORD (package age)
//
// .env holds the secrets nothing else has (the database password, the keys sessions are signed with), so it goes
// along, but never readable by whoever can read the bucket.
package offsite

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"filippo.io/age"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"deploy/internal/backup"
	"deploy/internal/envfile"
)

// Keys are the settings in .env, in the order Set up asks for them.
const (
	KeyEndpoint  = "BACKUP_S3_ENDPOINT"
	KeyBucket    = "BACKUP_S3_BUCKET"
	KeyRegion    = "BACKUP_S3_REGION"
	KeyAccessKey = "BACKUP_S3_ACCESS_KEY"
	KeySecretKey = "BACKUP_S3_SECRET_KEY"
	KeyKeep      = "BACKUP_S3_KEEP"
	KeyPassword  = "BACKUP_ENV_PASSWORD"
)

// DefaultKeep is how many backups of each kind stay in the bucket when BACKUP_S3_KEEP is unset.
const DefaultKeep = 30

// EnvObject is the encrypted .env's name under the prefix.
const EnvObject = "env.age"

// MinPassword is the shortest BACKUP_ENV_PASSWORD: the bucket's readers can try passwords against the file for as
// long as they like.
const MinPassword = 12

// Config is where the copies go.
type Config struct {
	Endpoint, Bucket, Region, AccessKey, SecretKey string
	// Password encrypts the copy of .env; empty leaves .env out.
	Password string
	// Keep is how many backups of each kind stay in the bucket.
	Keep int
	// Prefix is `<DOMAIN>/`.
	Prefix string
}

// Load reads the settings from .env. It returns nil without an error when off-site backups are off (no endpoint), and
// an error when they're half set.
func Load(env string) (*Config, error) {
	get := func(key string) string { return strings.TrimSpace(envfile.Get(env, key)) }
	c := &Config{
		Endpoint: get(KeyEndpoint), Bucket: get(KeyBucket), Region: get(KeyRegion),
		AccessKey: get(KeyAccessKey), SecretKey: get(KeySecretKey), Password: get(KeyPassword),
		Keep: DefaultKeep, Prefix: get("DOMAIN") + "/",
	}
	if c.Endpoint == "" {
		return nil, nil
	}
	if n, err := strconv.Atoi(get(KeyKeep)); err == nil && n > 0 {
		c.Keep = n
	}
	var missing []string
	for key, value := range map[string]string{KeyBucket: c.Bucket, KeyAccessKey: c.AccessKey, KeySecretKey: c.SecretKey} {
		if value == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		slices.Sort(missing)
		return nil, fmt.Errorf("%s is set but %s isn't", KeyEndpoint, strings.Join(missing, ", "))
	}
	if _, _, err := splitEndpoint(c.Endpoint); err != nil {
		return nil, err
	}
	return c, nil
}

// splitEndpoint turns `https://s3.example.com` into the host and whether it's TLS.
func splitEndpoint(endpoint string) (host string, secure bool, err error) {
	u, err := url.Parse(endpoint)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || strings.Trim(u.Path, "/") != "" {
		return "", false, fmt.Errorf("%s isn't a URL like https://s3.example.com (no bucket or path in it)", KeyEndpoint)
	}
	return u.Host, u.Scheme == "https", nil
}

func (c *Config) client() (*minio.Client, error) {
	host, secure, err := splitEndpoint(c.Endpoint)
	if err != nil {
		return nil, err
	}
	// The region is named, so the client doesn't ask the bucket for it: stores other than AWS often can't answer.
	region := c.Region
	if region == "" {
		region = "us-east-1"
	}
	return minio.New(host, &minio.Options{
		Creds:  credentials.NewStaticV4(c.AccessKey, c.SecretKey, ""),
		Secure: secure,
		Region: region,
	})
}

// explain turns the client's errors into ones an operator can act on, without its request ids and XML.
func explain(err error) error {
	if err == nil || errors.Is(err, context.Canceled) {
		return err
	}
	response := minio.ToErrorResponse(err)
	switch response.Code {
	case "":
		return fmt.Errorf("the store didn't answer (%v)", err)
	case "NoSuchBucket":
		return errors.New("the bucket doesn't exist")
	case "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch":
		return fmt.Errorf("the store refused the keys (%s)", response.Code)
	case "NoSuchKey":
		return errors.New("it isn't in the bucket")
	}
	return fmt.Errorf("the store answered %s: %s", response.Code, response.Message)
}

/*===== Probe =====*/

// Probe checks everything a backup needs from the bucket, by doing it once with a small object: write, list, read
// and delete. Keys that can only write would pass every night and fail on the day of the restore.
func (c *Config) Probe(ctx context.Context) error {
	client, err := c.client()
	if err != nil {
		return err
	}
	exists, err := client.BucketExists(ctx, c.Bucket)
	if err != nil {
		return explain(err)
	}
	if !exists {
		return fmt.Errorf("the bucket %s doesn't exist: create it at the provider first", c.Bucket)
	}
	name := c.Prefix + ".deploy-probe"
	body := []byte("written by deploy/deploy.sh offsite to check the bucket\n")
	if _, err := client.PutObject(ctx, c.Bucket, name, bytes.NewReader(body), int64(len(body)), minio.PutObjectOptions{}); err != nil {
		return fmt.Errorf("can't write to the bucket: %w", explain(err))
	}
	found := false
	for object := range client.ListObjects(ctx, c.Bucket, minio.ListObjectsOptions{Prefix: name}) {
		if object.Err != nil {
			return fmt.Errorf("can't list the bucket: %w", explain(object.Err))
		}
		found = found || object.Key == name
	}
	if !found {
		return errors.New("the bucket's listing doesn't show what was just written")
	}
	object, err := client.GetObject(ctx, c.Bucket, name, minio.GetObjectOptions{})
	if err == nil {
		_, err = io.Copy(io.Discard, object)
		object.Close()
	}
	if err != nil {
		return fmt.Errorf("can't read from the bucket: %w", explain(err))
	}
	if err := client.RemoveObject(ctx, c.Bucket, name, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("can't delete from the bucket, so old backups would pile up: %w", explain(err))
	}
	return nil
}

/*===== Backups =====*/

// Object is a backup in the bucket.
type Object struct {
	// Name is the file's name, without the prefix.
	Name     string
	Size     int64
	Modified time.Time
}

// IsDB and IsMedia tell the two kinds apart by name, as backup.File does.
func (o Object) IsDB() bool {
	return strings.HasPrefix(o.Name, "db-") && strings.HasSuffix(o.Name, ".dump")
}

func (o Object) IsMedia() bool {
	return strings.HasPrefix(o.Name, "media-") && strings.HasSuffix(o.Name, ".tar.gz")
}

// Sites lists the sites that keep backups in the bucket: its top-level folders, which are their domains. Recover
// offers them, so the domain of a lost server doesn't have to be typed from memory.
func (c *Config) Sites(ctx context.Context) ([]string, error) {
	client, err := c.client()
	if err != nil {
		return nil, err
	}
	var sites []string
	// Not recursive: the store answers with the folders themselves, as keys ending in a slash.
	for object := range client.ListObjects(ctx, c.Bucket, minio.ListObjectsOptions{}) {
		if object.Err != nil {
			return nil, explain(object.Err)
		}
		if site, ok := strings.CutSuffix(object.Key, "/"); ok && site != "" {
			sites = append(sites, site)
		}
	}
	slices.Sort(sites)
	return sites, nil
}

// Upload copies a backup file into the bucket under its own name. Large archives go up in parts.
func (c *Config) Upload(ctx context.Context, path string) error {
	client, err := c.client()
	if err != nil {
		return err
	}
	_, err = client.FPutObject(ctx, c.Bucket, c.Prefix+filepath.Base(path), path, minio.PutObjectOptions{
		ContentType: "application/octet-stream",
	})
	return explain(err)
}

// List lists the backups in the bucket, newest first by the time in their names: the bucket's own dates say when a
// file was uploaded, which for one uploaded again later isn't when it was made.
func (c *Config) List(ctx context.Context) ([]Object, error) {
	client, err := c.client()
	if err != nil {
		return nil, err
	}
	var objects []Object
	for object := range client.ListObjects(ctx, c.Bucket, minio.ListObjectsOptions{Prefix: c.Prefix}) {
		if object.Err != nil {
			return nil, explain(object.Err)
		}
		o := Object{Name: strings.TrimPrefix(object.Key, c.Prefix), Size: object.Size, Modified: object.LastModified}
		if o.IsDB() || o.IsMedia() {
			objects = append(objects, o)
		}
	}
	slices.SortFunc(objects, func(a, b Object) int { return strings.Compare(backup.StampOf(b.Name), backup.StampOf(a.Name)) })
	return objects, nil
}

// Download fetches a backup into dir, through a `.part` file readable only by its owner, and returns its path. The
// file gets the time in its name, not today's: the newest file in the folder is what "Last backup" reports.
func (c *Config) Download(ctx context.Context, name, dir string) (string, error) {
	client, err := c.client()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	part := path + ".part"
	if err := client.FGetObject(ctx, c.Bucket, c.Prefix+name, part, minio.GetObjectOptions{}); err != nil {
		os.Remove(part)
		return "", explain(err)
	}
	if err := os.Chmod(part, 0o600); err != nil {
		os.Remove(part)
		return "", err
	}
	if when, ok := backup.MadeAt(name); ok {
		_ = os.Chtimes(part, when, when)
	}
	return path, os.Rename(part, path)
}

// Prune removes all but the newest Keep backups of each kind from the bucket, and returns how many it removed.
func (c *Config) Prune(ctx context.Context) (int, error) {
	objects, err := c.List(ctx)
	if err != nil {
		return 0, err
	}
	client, err := c.client()
	if err != nil {
		return 0, err
	}
	removed, dbs, media := 0, 0, 0
	for _, o := range objects {
		count := &dbs
		if o.IsMedia() {
			count = &media
		}
		*count++
		if *count <= c.Keep {
			continue
		}
		if err := client.RemoveObject(ctx, c.Bucket, c.Prefix+o.Name, minio.RemoveObjectOptions{}); err != nil {
			return removed, explain(err)
		}
		removed++
	}
	return removed, nil
}

/*===== .env =====*/

// Encrypt encrypts content with a password (age's scrypt format, which the `age` command also reads:
// `age -d env.age`).
func Encrypt(content []byte, password string) ([]byte, error) {
	recipient, err := age.NewScryptRecipient(password)
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	w, err := age.Encrypt(&out, recipient)
	if err != nil {
		return nil, err
	}
	if _, err := w.Write(content); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// ErrWrongPassword is Decrypt's error for a password that isn't the file's.
var ErrWrongPassword = errors.New("the password isn't the one this copy was encrypted with")

// Decrypt reverses Encrypt.
func Decrypt(content []byte, password string) ([]byte, error) {
	identity, err := age.NewScryptIdentity(password)
	if err != nil {
		return nil, err
	}
	r, err := age.Decrypt(bytes.NewReader(content), identity)
	if err != nil {
		var noMatch *age.NoIdentityMatchError
		if errors.As(err, &noMatch) {
			return nil, ErrWrongPassword
		}
		return nil, fmt.Errorf("it isn't a file this tool encrypted (%v)", err)
	}
	return io.ReadAll(r)
}

// UploadEnv puts the encrypted .env in the bucket, over the last one. It does nothing without a password.
func (c *Config) UploadEnv(ctx context.Context, env string) error {
	if c.Password == "" {
		return nil
	}
	content, err := os.ReadFile(env)
	if err != nil {
		return err
	}
	encrypted, err := Encrypt(content, c.Password)
	if err != nil {
		return err
	}
	client, err := c.client()
	if err != nil {
		return err
	}
	_, err = client.PutObject(ctx, c.Bucket, c.Prefix+EnvObject, bytes.NewReader(encrypted), int64(len(encrypted)),
		minio.PutObjectOptions{ContentType: "application/octet-stream"})
	return explain(err)
}

// ErrNoEnv is FetchEnv's error for a site whose .env was left out of the bucket.
var ErrNoEnv = errors.New("there's no copy of .env in the bucket")

// FetchEnv downloads the encrypted .env and decrypts it with password.
func (c *Config) FetchEnv(ctx context.Context, password string) ([]byte, error) {
	client, err := c.client()
	if err != nil {
		return nil, err
	}
	object, err := client.GetObject(ctx, c.Bucket, c.Prefix+EnvObject, minio.GetObjectOptions{})
	if err != nil {
		return nil, explain(err)
	}
	defer object.Close()
	encrypted, err := io.ReadAll(object)
	if err != nil {
		// The client asks the store only on the first read, so a missing object shows here.
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return nil, ErrNoEnv
		}
		return nil, explain(err)
	}
	return Decrypt(encrypted, password)
}

/*===== Last upload =====*/

// The time of the last upload that worked is kept on the server, so the status lines and the hourly check can say how
// old the off-site copy is without asking the bucket each time.

// Mark records that an upload just worked.
func Mark(stateFile string) {
	_ = os.MkdirAll(filepath.Dir(stateFile), 0o755)
	_ = os.WriteFile(stateFile, []byte(time.Now().UTC().Format(time.RFC3339)+"\n"), 0o600)
}

// Last is when the last upload worked; the zero time when none did.
func Last(stateFile string) time.Time {
	content, err := os.ReadFile(stateFile)
	if err != nil {
		return time.Time{}
	}
	when, _ := time.Parse(time.RFC3339, strings.TrimSpace(string(content)))
	return when
}

// StateFile is where a checkout keeps the time of its last upload.
func StateFile(root string) string { return filepath.Join(root, "deploy", "logs", "offsite.state") }

/*===== Password =====*/

// CheckPassword says what's wrong with a password for the copy of .env, nil when it will do. It's kept in .env, which
// Compose reads too, so the characters Compose treats specially are out.
func CheckPassword(password string) error {
	switch {
	case len(password) < MinPassword:
		return fmt.Errorf("it needs at least %d characters", MinPassword)
	case strings.ContainsAny(password, " \t$#\"'`\\"):
		return errors.New("it can't have a space, quote, $, # or backslash (it's kept in .env)")
	}
	return nil
}
