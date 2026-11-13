package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

/*===== Sign-in =====*/

// The after-sign-in redirect must stay on the viewer. Browsers drop tabs and newlines from a URL, so `/<tab>/host`
// is `//host` to them.
func TestSafeNextStaysOnTheSite(t *testing.T) {
	for _, next := range []string{"/events/9ec79c33ec9942ab8353589fcb2e04dc", "/?q=path%3A%2Fnotes&level=error"} {
		if got := safeNext(next); got != next {
			t.Errorf("safeNext(%q) = %q, want it kept", next, got)
		}
	}
	hostile := []string{"", "https://evil.example", "//evil.example", `/\evil.example`, "/\t/evil.example",
		"/\n/evil.example", "/\r/evil.example", "\t//evil.example", "/\x00/evil.example", "javascript:alert(1)"}
	for _, next := range hostile {
		if got := safeNext(next); got != "/" {
			t.Errorf("safeNext(%q) = %q, want /", next, got)
		}
	}
}

func testWeb(t *testing.T) *web {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	st, err := openStore(filepath.Join(t.TempDir(), "errors.db"), log)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.close() })
	base, _ := url.Parse("http://localhost:8000")
	wb, err := newWeb(st, config{AdminPassword: "password", SessionSecret: strings.Repeat("s", 32), BaseURL: base}, log)
	if err != nil {
		t.Fatal(err)
	}
	return wb
}

// A session is only what the viewer signed and hasn't expired: a changed expiry, another secret's signature and a
// cookie past its time are all refused.
func TestSessionRefusesForgedAndExpiredCookies(t *testing.T) {
	wb := testWeb(t)
	signedIn := func(value string) bool {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: value})
		return wb.signedIn(req)
	}
	future := time.Now().Add(time.Hour).Unix()
	valid := wb.signSession(future)
	if !signedIn(valid) {
		t.Fatal("a fresh session was refused")
	}

	// The same signature under a later expiry.
	_, mac, _ := strings.Cut(valid, ".")
	if signedIn(strconv.FormatInt(future+3600, 10) + "." + mac) {
		t.Error("a session with a changed expiry was accepted")
	}
	if signedIn(wb.signSession(time.Now().Add(-time.Minute).Unix())) {
		t.Error("an expired session was accepted")
	}
	secret := wb.cfg.SessionSecret
	wb.cfg.SessionSecret = strings.Repeat("x", 32)
	foreign := wb.signSession(future)
	wb.cfg.SessionSecret = secret
	if signedIn(foreign) {
		t.Error("a session signed with another secret was accepted")
	}
	if signedIn("") || signedIn(strconv.FormatInt(future, 10)+".") {
		t.Error("a cookie without a signature was accepted")
	}
}

// Signing out must end the session itself, not only clear this browser's cookie: a copy of the cookie stops working.
func TestSignOutRevokesTheSession(t *testing.T) {
	server, _ := newTestServer(t)
	client := signIn(t, server)
	target, _ := url.Parse(server.URL)
	stolen := client.Jar.Cookies(target)

	if status, _ := getBody(t, client, server.URL+"/"); status != http.StatusOK {
		t.Fatalf("signed in: status %d", status)
	}
	res, err := client.PostForm(server.URL+"/logout", nil)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	req, _ := http.NewRequest(http.MethodGet, server.URL+"/", nil)
	for _, cookie := range stolen {
		req.AddCookie(cookie)
	}
	res, err = http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusSeeOther {
		t.Errorf("the copied cookie after sign-out: status %d, want a redirect to sign-in", res.StatusCode)
	}
}

func TestSignInIsRateLimitedPerAddress(t *testing.T) {
	server, _ := newTestServer(t)
	attempt := func(ip string) int {
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/login", strings.NewReader("password=wrong"))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("X-Real-IP", ip)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	for i := range 10 {
		if status := attempt("203.0.113.7"); status != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status %d", i+1, status)
		}
	}
	if status := attempt("203.0.113.7"); status != http.StatusTooManyRequests {
		t.Errorf("attempt 11: status %d, want 429", status)
	}
	// Another address still gets its own attempts, and an IPv6 address shares its /64's.
	if status := attempt("203.0.113.8"); status != http.StatusUnauthorized {
		t.Errorf("another address: status %d", status)
	}
	for i := range 10 {
		attempt("2001:db8:1:2::" + strconv.Itoa(i+1))
	}
	if status := attempt("2001:db8:1:2:ffff::1"); status != http.StatusTooManyRequests {
		t.Errorf("an eleventh address of one /64: status %d, want 429", status)
	}
}

func TestAddressKey(t *testing.T) {
	cases := map[string]string{
		"203.0.113.7":         "203.0.113.7",
		"::ffff:203.0.113.7":  "203.0.113.7",
		"2001:db8:1:2:3:4::5": "2001:db8:1:2::/64",
	}
	for address, want := range cases {
		if got := addressKey(netip.MustParseAddr(address)); got != want {
			t.Errorf("addressKey(%s) = %s, want %s", address, got, want)
		}
	}
}

/*===== Cross-origin Posts =====*/

// Another site's page can make the signed-in browser post a form; the dashboard must refuse it.
func TestDashboardRefusesCrossOriginPosts(t *testing.T) {
	server, st := newTestServer(t)
	postEnvelope(t, server, "/api/1/envelope/?sentry_key="+testKey, sampleEnvelope)
	waitForEvents(t, st, 1)
	client := signIn(t, server)

	post := func(origin string) int {
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/events/9ec79c33ec9942ab8353589fcb2e04dc/delete", nil)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	if status := post("https://evil.example"); status != http.StatusForbidden {
		t.Errorf("cross-origin delete: status %d, want 403", status)
	}
	if _, err := st.get(context.Background(), "9ec79c33ec9942ab8353589fcb2e04dc"); err != nil {
		t.Errorf("the event after a refused delete: %v", err)
	}
	if status := post(server.URL); status != http.StatusSeeOther {
		t.Errorf("same-origin delete: status %d", status)
	}
}

/*===== Ingest Limits =====*/

func postBody(t *testing.T, server *httptest.Server, body []byte, headers map[string]string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/1/envelope/?sentry_key="+testKey, bytes.NewReader(body))
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res
}

func TestIngestCapsBodySize(t *testing.T) {
	server, _ := newTestServer(t)

	tooLong := bytes.Repeat([]byte("a"), maxBodyBytes+1)
	if res := postBody(t, server, tooLong, nil); res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("a body over the wire cap: status %d, want 413", res.StatusCode)
	}

	// Small on the wire, 9 MB once unzipped.
	var bomb bytes.Buffer
	zip := gzip.NewWriter(&bomb)
	_, _ = zip.Write(make([]byte, maxPayloadBytes+(1<<20)))
	_ = zip.Close()
	res := postBody(t, server, bomb.Bytes(), map[string]string{"Content-Encoding": "gzip"})
	if res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("a zip bomb: status %d, want 413", res.StatusCode)
	}

	var zipped bytes.Buffer
	zip = gzip.NewWriter(&zipped)
	_, _ = zip.Write([]byte(sampleEnvelope))
	_ = zip.Close()
	if res := postBody(t, server, zipped.Bytes(), map[string]string{"Content-Encoding": "gzip"}); res.StatusCode != http.StatusOK {
		t.Errorf("a gzipped envelope: status %d", res.StatusCode)
	}
}

// One address gets a burst of events, then 429 with Retry-After, which the SDKs obey. Envelopes without events don't
// use that budget but have their own, so they can't be sent without end either.
func TestIngestLimitsEachAddress(t *testing.T) {
	server, _ := newTestServer(t)
	from := func(ip, body string) *http.Response {
		return postBody(t, server, []byte(body), map[string]string{"X-Real-IP": ip})
	}

	for i := range ingestPerIPBurst {
		envelope := strings.ReplaceAll(sampleEnvelope, "9ec7", strconv.FormatInt(int64(0x1000+i), 16))
		if res := from("203.0.113.7", envelope); res.StatusCode != http.StatusOK {
			t.Fatalf("event %d: status %d", i+1, res.StatusCode)
		}
	}
	res := from("203.0.113.7", sampleEnvelope)
	if res.StatusCode != http.StatusTooManyRequests || res.Header.Get("Retry-After") == "" {
		t.Errorf("past the burst: status %d, Retry-After %q", res.StatusCode, res.Header.Get("Retry-After"))
	}
	if res := from("203.0.113.8", sampleEnvelope); res.StatusCode != http.StatusOK {
		t.Errorf("another address: status %d", res.StatusCode)
	}

	session := "{}\n{\"type\":\"session\"}\n{}\n"
	limited := false
	for range ingestRequestsBurst + 1 {
		if from("203.0.113.9", session).StatusCode == http.StatusTooManyRequests {
			limited = true
		}
	}
	if !limited {
		t.Error("envelopes without events were never limited")
	}
}

/*===== Escaping =====*/

// Everything in an event comes from whoever holds the public key, which is every visitor of the app. None of it may
// reach the page as markup.
func TestHostileEventValuesAreEscaped(t *testing.T) {
	server, st := newTestServer(t)
	// An item's payload is one line.
	event := strings.ReplaceAll(`{"event_id":"9ec79c33ec9942ab8353589fcb2e04dc","platform":"javascript","release":"\"><script>alert(3)</script>",
"exception":{"values":[{"type":"<script>alert(1)</script>","value":"<img src=x onerror=alert(2)>",
"stacktrace":{"frames":[{"function":"<script>alert(4)</script>","filename":"<script>alert(5)</script>","lineno":1,
"context_line":"<script>alert(6)</script>"}]}}]},
"tags":{"path":"/<script>alert(7)</script>","<script>alert(8)</script>":"<script>alert(9)</script>"},
"user":{"id":"<script>alert(10)</script>"},"extra":{"k":"<script>alert(11)</script>"},
"breadcrumbs":{"values":[{"category":"<script>alert(12)</script>","message":"<script>alert(13)</script>","data":{"u":"<script>alert(14)</script>"}}]}}`, "\n", "")
	envelope := "{}\n{\"type\":\"event\"}\n" + event + "\n"
	postEnvelope(t, server, "/api/1/envelope/?sentry_key="+testKey, envelope)
	waitForEvents(t, st, 1)
	client := signIn(t, server)

	for _, path := range []string{"/", "/?group=1", "/events/9ec79c33ec9942ab8353589fcb2e04dc"} {
		status, body := getBody(t, client, server.URL+path)
		if status != http.StatusOK || !strings.Contains(body, "&lt;script&gt;alert(1)") {
			t.Errorf("%s: status %d, escaped title present: %v", path, status, strings.Contains(body, "&lt;script&gt;alert(1)"))
		}
		if strings.Contains(body, "<script>alert(") || strings.Contains(body, "<img src=x") {
			t.Errorf("%s: an event value reached the page as markup", path)
		}
	}
}
