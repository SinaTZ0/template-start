package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

/*===== Setup =====*/

const testKey = "0123456789abcdef0123456789abcdef"

func newTestServer(t *testing.T) (*httptest.Server, *store) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	st, err := openStore(filepath.Join(t.TempDir(), "errors.db"), log)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.close() })

	base, _ := url.Parse("http://localhost:8000")
	cfg := config{
		ProjectID:     "1",
		PublicKey:     testKey,
		AdminPassword: "password",
		SessionSecret: strings.Repeat("s", 32),
		AllowedOrigin: "http://localhost:5173",
		BaseURL:       base,
	}
	handler, err := newHandler(st, cfg, log)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server, st
}

func postEnvelope(t *testing.T, server *httptest.Server, path, body string) *http.Response {
	t.Helper()
	res, err := http.Post(server.URL+path, "text/plain", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res
}

// waitForEvents polls until the writer has stored n events.
func waitForEvents(t *testing.T, st *store, n int) []eventRow {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		events, _, err := st.list(context.Background(), eventFilter{}, nil, 100)
		if err != nil {
			t.Fatal(err)
		}
		if len(events) >= n || time.Now().After(deadline) {
			return events
		}
		time.Sleep(10 * time.Millisecond)
	}
}

const sampleEnvelope = `{"event_id":"9ec79c33ec9942ab8353589fcb2e04dc"}
{"type":"event"}
{"event_id":"9ec79c33ec9942ab8353589fcb2e04dc","message":"boom","tags":{"errorId":"4f1c2b9e-0000-4000-8000-000000000000"}}
`

/*===== Ingest =====*/

func TestIngestRejectsWrongKeyAndProject(t *testing.T) {
	server, _ := newTestServer(t)

	cases := map[string]int{
		"/api/1/envelope/?sentry_key=wrong":      http.StatusUnauthorized,
		"/api/1/envelope/":                       http.StatusUnauthorized,
		"/api/2/envelope/?sentry_key=" + testKey: http.StatusNotFound,
	}
	for path, want := range cases {
		if res := postEnvelope(t, server, path, sampleEnvelope); res.StatusCode != want {
			t.Errorf("%s: status %d, want %d", path, res.StatusCode, want)
		}
	}

	// The node SDK's header form.
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/1/envelope/", strings.NewReader(sampleEnvelope))
	req.Header.Set("X-Sentry-Auth", "Sentry sentry_version=7, sentry_key="+testKey+", sentry_client=sentry.javascript.node")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("header auth: status %d", res.StatusCode)
	}
}

// SDKs retry a send they believe failed; the same event_id must be stored once.
func TestIngestDeduplicatesRetries(t *testing.T) {
	server, st := newTestServer(t)
	for range 2 {
		if res := postEnvelope(t, server, "/api/1/envelope/?sentry_key="+testKey, sampleEnvelope); res.StatusCode != http.StatusOK {
			t.Fatalf("status %d", res.StatusCode)
		}
	}
	// A second, different event proves the writer has caught up before counting.
	other := strings.ReplaceAll(sampleEnvelope, "9ec79c33ec9942ab8353589fcb2e04dc", "1ec79c33ec9942ab8353589fcb2e04dc")
	postEnvelope(t, server, "/api/1/envelope/?sentry_key="+testKey, other)

	if events := waitForEvents(t, st, 2); len(events) != 2 {
		t.Errorf("stored %d events, want 2", len(events))
	}
}

/*===== Dashboard =====*/

// Only the checked events may go: a malformed ID is dropped, and an event that wasn't posted must survive.
func TestDeleteSelectedRemovesOnlyChosenEvents(t *testing.T) {
	server, st := newTestServer(t)
	other := strings.ReplaceAll(sampleEnvelope, "9ec79c33ec9942ab8353589fcb2e04dc", "1ec79c33ec9942ab8353589fcb2e04dc")
	postEnvelope(t, server, "/api/1/envelope/?sentry_key="+testKey, sampleEnvelope)
	postEnvelope(t, server, "/api/1/envelope/?sentry_key="+testKey, other)
	waitForEvents(t, st, 2)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	res, err := client.PostForm(server.URL+"/login", url.Values{"password": {"password"}})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	res, err = client.PostForm(server.URL+"/events/delete-selected", url.Values{
		"id": {"9ec79c33ec9942ab8353589fcb2e04dc", "not-an-id"},
	})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	ctx := context.Background()
	if _, err := st.get(ctx, "9ec79c33ec9942ab8353589fcb2e04dc"); !errors.Is(err, errNotFound) {
		t.Errorf("chosen event: err %v, want not found", err)
	}
	if _, err := st.get(ctx, "1ec79c33ec9942ab8353589fcb2e04dc"); err != nil {
		t.Errorf("unchosen event: %v", err)
	}
}

func TestDashboardNeedsSignIn(t *testing.T) {
	server, _ := newTestServer(t)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	res, err := client.Get(server.URL + "/events/9ec79c33ec9942ab8353589fcb2e04dc")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusSeeOther || !strings.HasPrefix(res.Header.Get("Location"), "/login") {
		t.Errorf("status %d, location %q", res.StatusCode, res.Header.Get("Location"))
	}

	res, err = client.PostForm(server.URL+"/login", url.Values{"password": {"wrong"}})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Errorf("wrong password: status %d", res.StatusCode)
	}
}

// Renders every page with a stored event, so a template that only fails at execution time fails here.
func TestDashboardPagesRender(t *testing.T) {
	server, st := newTestServer(t)
	postEnvelope(t, server, "/api/1/envelope/?sentry_key="+testKey, sampleEnvelope)
	waitForEvents(t, st, 1)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	res, err := client.PostForm(server.URL+"/login", url.Values{"password": {"password"}})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	pages := map[string]string{
		"/": "boom",
		"/?q=4f1c2b9e-0000-4000-8000-000000000000&auto=1": "boom",
		"/events/9ec79c33ec9942ab8353589fcb2e04dc":        "4f1c2b9e-0000-4000-8000-000000000000",
		"/rows?after=0-": "boom",
	}
	for path, want := range pages {
		res, err := client.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusOK || !strings.Contains(string(body), want) {
			t.Errorf("%s: status %d, body contains %q: %v", path, res.StatusCode, want, strings.Contains(string(body), want))
		}
	}
}
