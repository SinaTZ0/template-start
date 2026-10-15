// Command error-viewer receives the app's error and slow-request reports over Sentry's envelope protocol, stores them in
// SQLite and shows them on a small dashboard. See README.md.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"syscall"
	"time"
)

/*===== Configuration =====*/

type config struct {
	ListenAddr    string
	DataDir       string
	ProjectID     string
	PublicKey     string
	AdminPassword string
	SessionSecret string
	AllowedOrigin string
	BaseURL       *url.URL
	RetentionDays int
	MaxEvents     int
}

// loadConfig reads the environment. Every problem is collected, so one start shows all of them.
func loadConfig() (config, error) {
	var problems []error
	required := func(name string) string {
		value := os.Getenv(name)
		if value == "" {
			problems = append(problems, fmt.Errorf("%s is required", name))
		}
		return value
	}
	optional := func(name, fallback string) string {
		if value := os.Getenv(name); value != "" {
			return value
		}
		return fallback
	}
	positiveInt := func(name string, fallback int) int {
		value := os.Getenv(name)
		if value == "" {
			return fallback
		}
		n, err := strconv.Atoi(value)
		if err != nil || n <= 0 {
			problems = append(problems, fmt.Errorf("%s must be a positive whole number", name))
		}
		return n
	}

	cfg := config{
		ListenAddr:    optional("LISTEN_ADDR", ":8000"),
		DataDir:       optional("DATA_DIR", "/data"),
		ProjectID:     optional("PROJECT_ID", "1"),
		PublicKey:     required("PUBLIC_KEY"),
		AdminPassword: required("ADMIN_PASSWORD"),
		SessionSecret: required("SESSION_SECRET"),
		AllowedOrigin: required("ALLOWED_ORIGIN"),
		RetentionDays: positiveInt("RETENTION_DAYS", 30),
		MaxEvents:     positiveInt("MAX_EVENTS", 50_000),
	}

	if baseURL := required("BASE_URL"); baseURL != "" {
		u, err := url.Parse(baseURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			problems = append(problems, errors.New("BASE_URL must be an http(s) URL, like https://errors.example.com"))
		}
		cfg.BaseURL = u
	}
	// The Sentry SDKs parse the DSN's key as `\w+`. Any other character makes them reject the DSN and silently send
	// nothing, so such a key is refused here instead.
	if cfg.PublicKey != "" && !dsnKeyPattern.MatchString(cfg.PublicKey) {
		problems = append(problems, errors.New("PUBLIC_KEY may contain only letters, digits and _ (openssl rand -hex 16)"))
	}
	if cfg.SessionSecret != "" && len(cfg.SessionSecret) < 32 {
		problems = append(problems, errors.New("SESSION_SECRET must be at least 32 characters (openssl rand -hex 32)"))
	}
	return cfg, errors.Join(problems...)
}

var dsnKeyPattern = regexp.MustCompile(`^\w+$`)

// dsn is what the app puts in SENTRY_DSN: `<scheme>://<key>@<host>/<project>`.
func (cfg config) dsn() string {
	return fmt.Sprintf("%s://%s@%s/%s", cfg.BaseURL.Scheme, cfg.PublicKey, cfg.BaseURL.Host, cfg.ProjectID)
}

/*===== Entry Point =====*/

func main() {
	// The image has no shell or curl, so Docker's health check runs the binary itself.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}

	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("error viewer stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}

	/*------ Storage ------*/
	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		return err
	}
	st, err := openStore(filepath.Join(cfg.DataDir, "errors.db"), log)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	retentionDone := make(chan struct{})
	go func() {
		defer close(retentionDone)
		st.runRetention(ctx, time.Duration(cfg.RetentionDays)*24*time.Hour, cfg.MaxEvents)
	}()

	/*------ HTTP ------*/
	handler, err := newHandler(st, cfg, log)
	if err != nil {
		return err
	}
	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- server.ListenAndServe() }()
	log.Info("error viewer listening", "addr", cfg.ListenAddr, "dashboard", cfg.BaseURL.String(), "SENTRY_DSN", cfg.dsn())

	/*------ Shutdown ------*/
	select {
	case err := <-serveErr:
		stop()
		<-retentionDone
		_ = st.close()
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")

	// Handlers finish first, so nothing enqueues after the queue closes; then the writer flushes what is queued.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Error("http shutdown", "err", err)
	}
	<-retentionDone
	return st.close()
}

// healthcheck asks the running server's /healthz and returns the process exit code.
func healthcheck() int {
	_, port, err := net.SplitHostPort(os.Getenv("LISTEN_ADDR"))
	if err != nil || port == "" {
		port = "8000"
	}
	client := http.Client{Timeout: 3 * time.Second}
	res, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthz:", res.Status)
		return 1
	}
	return 0
}
