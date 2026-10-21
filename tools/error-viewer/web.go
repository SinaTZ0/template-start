package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

//go:embed templates static
var assets embed.FS

/*===== Wiring =====*/

// newHandler builds the whole HTTP surface. The ingest endpoint and /healthz are public; everything else needs a
// session and is protected against cross-origin form posts. Ingest stays outside that protection on purpose: browsers
// post to it from the app's origin.
func newHandler(st *store, cfg config, log *slog.Logger) (http.Handler, error) {
	wb, err := newWeb(st, cfg, log)
	if err != nil {
		return nil, err
	}

	public := http.NewServeMux()
	newIngest(st, cfg, log).routes(public)
	public.HandleFunc("GET /healthz", wb.healthz)

	dashboard := http.NewServeMux()
	wb.routes(dashboard)
	protected := http.NewCrossOriginProtection().Handler(wb.requireSession(noStore(dashboard)))

	root := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" {
			public.ServeHTTP(w, r)
			return
		}
		protected.ServeHTTP(w, r)
	})
	return securityHeaders(root), nil
}

// securityHeaders allows only the viewer's own scripts and styles: htmx and app.js are served from the binary, so no
// inline script or style is ever needed (htmx's injected indicator styles are turned off in layout.html).
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

// noStore keeps dashboard pages out of the browser's cache. The list URL serves both the whole page and, to htmx, the
// results fragment; a cached fragment would otherwise come back alone on the back button. Static files set their own
// caching.
func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/static/") {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Vary", "HX-Request, HX-Target")
		}
		next.ServeHTTP(w, r)
	})
}

/*===== Dashboard =====*/

type web struct {
	store     *store
	cfg       config
	log       *slog.Logger
	pages     map[string]*template.Template
	static    http.Handler
	assetHash map[string]string
	logins    *rateLimiter
}

const (
	pageSize      = 50
	maxSelected   = 1000 // caps one delete post, far above what the list can hold checked at once
	sessionCookie = "error_viewer_session"
	sessionMaxAge = 7 * 24 * time.Hour
)

func newWeb(st *store, cfg config, log *slog.Logger) (*web, error) {
	wb := &web{
		store:     st,
		cfg:       cfg,
		log:       log,
		assetHash: map[string]string{},
		// Five attempts a minute per address, after a first burst of ten.
		logins: newRateLimiter(5, 10),
	}

	/*------ Static Files ------*/
	staticFS, err := fs.Sub(assets, "static")
	if err != nil {
		return nil, err
	}
	// Each asset URL carries a hash of its content, so browsers may cache it for good and still get a new version
	// after an upgrade.
	err = fs.WalkDir(staticFS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		content, err := fs.ReadFile(staticFS, path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(content)
		wb.assetHash[path] = hex.EncodeToString(sum[:4])
		return nil
	})
	if err != nil {
		return nil, err
	}
	fileServer := http.StripPrefix("/static/", http.FileServerFS(staticFS))
	wb.static = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		fileServer.ServeHTTP(w, r)
	})

	/*------ Templates ------*/
	// Parsed once at startup, so a broken template stops the viewer from starting instead of failing a page later.
	funcs := template.FuncMap{
		"asset":     wb.assetURL,
		"iso":       isoTime,
		"exact":     exactTime,
		"ago":       func(ms int64) string { return ago(ms, time.Now()) },
		"short":     func(s string) string { return clip(s, 9) },
		"searchURL": searchURL,
	}
	pageFiles := map[string][]string{
		"list":   {"layout.html", "list.html", "rows.html"},
		"detail": {"layout.html", "detail.html"},
		"login":  {"layout.html", "login.html"},
	}
	wb.pages = map[string]*template.Template{}
	for name, files := range pageFiles {
		paths := make([]string, len(files))
		for i, file := range files {
			paths[i] = "templates/" + file
		}
		tmpl, err := template.New(name).Funcs(funcs).ParseFS(assets, paths...)
		if err != nil {
			return nil, fmt.Errorf("parse %s templates: %w", name, err)
		}
		wb.pages[name] = tmpl
	}
	return wb, nil
}

func (wb *web) routes(mux *http.ServeMux) {
	mux.Handle("GET /static/", wb.static)
	mux.HandleFunc("GET /login", wb.loginPage)
	mux.HandleFunc("POST /login", wb.login)
	mux.HandleFunc("POST /logout", wb.logout)
	mux.HandleFunc("GET /{$}", wb.list)
	mux.HandleFunc("GET /rows", wb.rows)
	mux.HandleFunc("POST /events/delete", wb.deleteMatching)
	mux.HandleFunc("POST /events/delete-selected", wb.deleteSelected)
	mux.HandleFunc("GET /events/{id}", wb.detail)
	mux.HandleFunc("POST /events/{id}/delete", wb.deleteEvent)
}

func (wb *web) assetURL(name string) string {
	return "/static/" + name + "?v=" + wb.assetHash[name]
}

/*===== Rendering =====*/

// page is what layout.html renders: the shared frame, with the page's own data in Body.
type page struct {
	Title    string
	SignedIn bool
	Body     any
}

// render executes one template of a page's set into a buffer first, so a template error becomes a clean 500
// instead of half a page.
func (wb *web) render(w http.ResponseWriter, r *http.Request, set, name string, status int, data any) {
	var buf bytes.Buffer
	if err := wb.pages[set].ExecuteTemplate(&buf, name, data); err != nil {
		wb.serverError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = buf.WriteTo(w)
}

func (wb *web) serverError(w http.ResponseWriter, r *http.Request, err error) {
	wb.log.Error("request failed", "err", err, "method", r.Method, "path", r.URL.Path)
	http.Error(w, "Something went wrong. The viewer's log has the details.", http.StatusInternalServerError)
}

// isPartial reports whether htmx asked for the fragment it swaps into the given target, rather than a whole page. A
// history restore (back button after the cache expired) needs the whole page.
func isPartial(r *http.Request, target string) bool {
	return r.Header.Get("HX-Request") == "true" && r.Header.Get("HX-History-Restore-Request") != "true" &&
		r.Header.Get("HX-Target") == target
}

// redirect sends the browser to `to`: htmx follows `HX-Redirect`, a plain form post follows a 303.
func redirect(w http.ResponseWriter, r *http.Request, to string) {
	if r.Header.Get("HX-Request") == "true" {
		w.Header().Set("HX-Redirect", to)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	http.Redirect(w, r, to, http.StatusSeeOther)
}

/*===== Health =====*/

func (wb *web) healthz(w http.ResponseWriter, r *http.Request) {
	if err := wb.store.db.PingContext(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

/*===== List =====*/

// listQuery is the list's state as it appears in the URL, so a filtered view can be bookmarked and shared.
type listQuery struct {
	Q        string
	Level    string
	Kind     string
	Platform string
	Env      string
	Range    string
	Auto     bool
}

var (
	levelOptions    = []string{"fatal", "error", "warning", "info", "debug"}
	kindOptions     = []string{"error", "slow", "message", "browser"}
	platformOptions = []string{"node", "javascript"}
	rangeOptions    = map[string]time.Duration{"hour": time.Hour, "day": 24 * time.Hour, "week": 7 * 24 * time.Hour}
)

func readListQuery(values url.Values) listQuery {
	oneOf := func(value string, options []string) string {
		for _, option := range options {
			if value == option {
				return value
			}
		}
		return ""
	}
	q := listQuery{
		Q:        clip(strings.TrimSpace(values.Get("q")), 300),
		Level:    oneOf(values.Get("level"), levelOptions),
		Kind:     oneOf(values.Get("kind"), kindOptions),
		Platform: oneOf(values.Get("platform"), platformOptions),
		Env:      clip(values.Get("env"), 64),
		Auto:     values.Get("auto") == "1",
	}
	if _, ok := rangeOptions[values.Get("range")]; ok {
		q.Range = values.Get("range")
	}
	return q
}

// encode returns the query string, without empty fields.
func (q listQuery) encode() string {
	values := url.Values{}
	set := func(key, value string) {
		if value != "" {
			values.Set(key, value)
		}
	}
	set("q", q.Q)
	set("level", q.Level)
	set("kind", q.Kind)
	set("platform", q.Platform)
	set("env", q.Env)
	set("range", q.Range)
	if q.Auto {
		values.Set("auto", "1")
	}
	return values.Encode()
}

// Filtered reports whether anything narrows the list (auto-refresh doesn't).
func (q listQuery) Filtered() bool {
	q.Auto = false
	return q != listQuery{}
}

var (
	uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	// 16 hex characters since the app's reqIds became 64-bit; 8 for the events stored before.
	reqIDPattern = regexp.MustCompile(`^(?:[0-9a-fA-F]{16}|[0-9a-fA-F]{8})$`)
	// `prefix:value` searches. IDs are matched lowercased, as the app generates them.
	searchPrefixes = map[string]struct {
		column string
		lower  bool
	}{
		"errorid":  {"error_id", true},
		"reqid":    {"req_id", true},
		"path":     {"path", false},
		"route":    {"route", false},
		"module":   {"module", false},
		"clientid": {"client_id", true},
	}
)

// filter turns the URL state into a store filter. The search box understands a bare errorId (a UUID), a bare reqId
// (16 hex characters, or 8 for older events), `column:value` for errorId / reqId / path / route / module / clientId, and otherwise searches
// titles.
func (q listQuery) filter(now time.Time) eventFilter {
	f := eventFilter{Level: q.Level, Kind: q.Kind, Platform: q.Platform, Environment: q.Env}
	if d, ok := rangeOptions[q.Range]; ok {
		f.Since = now.Add(-d).UnixMilli()
	}

	switch search := q.Q; {
	case search == "":
	case uuidPattern.MatchString(search):
		f.Column, f.Value = "error_id", strings.ToLower(search)
	case reqIDPattern.MatchString(search):
		f.Column, f.Value = "req_id", strings.ToLower(search)
	default:
		prefix, value, found := strings.Cut(search, ":")
		if p, ok := searchPrefixes[strings.ToLower(prefix)]; found && ok {
			value = strings.TrimSpace(value)
			if p.lower {
				value = strings.ToLower(value)
			}
			f.Column, f.Value = p.column, value
		} else {
			f.Text = search
		}
	}
	return f
}

// searchURL is the list filtered by one column, linked from the detail page's tags.
func searchURL(prefix, value string) string {
	return "/?q=" + url.QueryEscape(prefix+":"+value)
}

/*------ View Data ------*/

type listView struct {
	Query        listQuery
	Rows         rowsView
	Poller       pollerView
	Environments []string
	Days         []dayBar
	Levels       []string
	Kinds        []string
	Platforms    []string
}

// rowsView is a run of table rows and, if older events exist, the "Load more" row after them.
type rowsView struct {
	Events      []eventRow
	More        bool
	MoreURL     string // the full page, for a browser without htmx
	MoreRowsURL string
	First       bool // the first page: an empty one shows "No events"
}

// pollerView is the auto-refresh element: it asks for rows newer than the newest one shown every 10 s, prepends
// them out of band and replaces itself with a poller that starts from the new newest row.
type pollerView struct {
	On  bool
	URL string
}

type newerView struct {
	Events []eventRow
	Poller pollerView
}

func (wb *web) list(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	query := readListQuery(r.URL.Query())
	before, _ := parseCursor(r.URL.Query().Get("before"))
	var beforePtr *cursor
	if r.URL.Query().Has("before") {
		beforePtr = &before
	}

	events, more, err := wb.store.list(r.Context(), query.filter(now), beforePtr, pageSize)
	if err != nil {
		wb.serverError(w, r, err)
		return
	}
	view := listView{
		Query:     query,
		Rows:      wb.rowsView(query, events, more, beforePtr == nil),
		Poller:    wb.pollerView(query, events, cursor{}),
		Levels:    levelOptions,
		Kinds:     kindOptions,
		Platforms: platformOptions,
	}
	if isPartial(r, "results") {
		wb.render(w, r, "list", "results", http.StatusOK, view)
		return
	}

	/*------ Whole Page ------*/
	if view.Environments, err = wb.store.environments(r.Context()); err != nil {
		wb.serverError(w, r, err)
		return
	}
	counts, err := wb.store.countByDay(r.Context(), 14, now)
	if err != nil {
		wb.serverError(w, r, err)
		return
	}
	view.Days = dayBars(counts)
	wb.render(w, r, "list", "layout", http.StatusOK, page{Title: "Events", SignedIn: true, Body: view})
}

// rows serves the htmx fragments: older rows for "Load more" (`before`), or newer rows for auto-refresh (`after`).
func (wb *web) rows(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	query := readListQuery(r.URL.Query())
	filter := query.filter(now)

	if r.URL.Query().Has("after") {
		after, ok := parseCursor(r.URL.Query().Get("after"))
		if !ok {
			http.Error(w, "bad cursor", http.StatusBadRequest)
			return
		}
		// More than a page arriving within one poll leaves a gap in the list; reloading shows everything.
		events, err := wb.store.newer(r.Context(), filter, after, pageSize)
		if err != nil {
			wb.serverError(w, r, err)
			return
		}
		view := newerView{Events: events, Poller: wb.pollerView(query, events, after)}
		wb.render(w, r, "list", "newer", http.StatusOK, view)
		return
	}

	before, ok := parseCursor(r.URL.Query().Get("before"))
	if !ok {
		http.Error(w, "bad cursor", http.StatusBadRequest)
		return
	}
	events, more, err := wb.store.list(r.Context(), filter, &before, pageSize)
	if err != nil {
		wb.serverError(w, r, err)
		return
	}
	wb.render(w, r, "list", "rows", http.StatusOK, wb.rowsView(query, events, more, false))
}

func (wb *web) rowsView(query listQuery, events []eventRow, more, first bool) rowsView {
	view := rowsView{Events: events, More: more, First: first}
	if more {
		next := events[len(events)-1].Cursor()
		params := query.encode()
		if params != "" {
			params += "&"
		}
		params += "before=" + url.QueryEscape(next)
		view.MoreURL = "/?" + params
		view.MoreRowsURL = "/rows?" + params
	}
	return view
}

// pollerView starts from the newest of events, or from `from` when there are none (nothing new arrived).
func (wb *web) pollerView(query listQuery, events []eventRow, from cursor) pollerView {
	if !query.Auto {
		return pollerView{}
	}
	if len(events) > 0 {
		from = cursor{At: events[0].ReceivedAt, ID: events[0].ID}
	}
	params := query.encode()
	if params != "" {
		params += "&"
	}
	return pollerView{On: true, URL: "/rows?" + params + "after=" + url.QueryEscape(from.String())}
}

/*------ Count by Day ------*/

// dayBar is one bar of the 14-day strip, drawn as SVG (an inline `style` height would break the CSP).
type dayBar struct {
	X, Y, Height int
	Count        int
	Label        string
}

const (
	barWidth  = 12
	barGap    = 3
	barHeight = 32
)

func dayBars(counts []dayCount) []dayBar {
	peak := 0
	for _, c := range counts {
		peak = max(peak, c.Count)
	}
	bars := make([]dayBar, len(counts))
	for i, c := range counts {
		height := 1 // an empty day still shows a baseline
		if peak > 0 && c.Count > 0 {
			height = max(2, c.Count*barHeight/peak)
		}
		bars[i] = dayBar{
			X:      i * (barWidth + barGap),
			Y:      barHeight - height,
			Height: height,
			Count:  c.Count,
			Label:  c.Day.Format("Mon 2 Jan"),
		}
	}
	return bars
}

/*===== Detail =====*/

func (wb *web) detail(w http.ResponseWriter, r *http.Request) {
	id := normalizeEventID(r.PathValue("id"))
	if id == "" {
		http.NotFound(w, r)
		return
	}
	row, err := wb.store.get(r.Context(), id)
	if errors.Is(err, errNotFound) {
		wb.render(w, r, "detail", "layout", http.StatusNotFound,
			page{Title: "Not found", SignedIn: true, Body: detailView{Missing: true}})
		return
	}
	if err != nil {
		wb.serverError(w, r, err)
		return
	}
	wb.render(w, r, "detail", "layout", http.StatusOK,
		page{Title: row.Title, SignedIn: true, Body: buildDetail(row)})
}

/*===== Deleting =====*/

func (wb *web) deleteEvent(w http.ResponseWriter, r *http.Request) {
	id := normalizeEventID(r.PathValue("id"))
	if id == "" {
		http.NotFound(w, r)
		return
	}
	if err := wb.store.delete(r.Context(), id); err != nil {
		wb.serverError(w, r, err)
		return
	}
	redirect(w, r, "/")
}

// deleteMatching deletes everything the posted filters match, then shows the (now empty) filtered list.
func (wb *web) deleteMatching(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	query := readListQuery(r.PostForm)
	deleted, err := wb.store.deleteMatching(r.Context(), query.filter(time.Now()))
	if err != nil {
		wb.serverError(w, r, err)
		return
	}
	wb.log.Info("deleted matching events", "count", deleted, "filter", query.encode())
	redirect(w, r, "/?"+query.encode())
}

// deleteSelected deletes the events whose row checkboxes were posted, then shows the filtered list again. Anything that
// isn't an event ID is dropped, so a hand-edited form can only ever name events.
func (wb *web) deleteSelected(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	posted := r.PostForm["id"]
	if len(posted) > maxSelected {
		http.Error(w, "too many events selected", http.StatusBadRequest)
		return
	}
	ids := make([]string, 0, len(posted))
	for _, id := range posted {
		if id = normalizeEventID(id); id != "" {
			ids = append(ids, id)
		}
	}
	query := readListQuery(r.PostForm)
	deleted, err := wb.store.deleteIDs(r.Context(), ids)
	if err != nil {
		wb.serverError(w, r, err)
		return
	}
	wb.log.Info("deleted selected events", "count", deleted, "filter", query.encode())
	redirect(w, r, "/?"+query.encode())
}

/*===== Sign-in =====*/

// requireSession lets only signed-in visitors past, except to the sign-in page and static files. A page visit is sent
// to /login and comes back afterwards; an htmx request is redirected as a whole page.
func (wb *web) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login" || strings.HasPrefix(r.URL.Path, "/static/") || wb.signedIn(r) {
			next.ServeHTTP(w, r)
			return
		}
		to := "/login"
		if r.Method == http.MethodGet && r.URL.Path != "/" {
			to += "?next=" + url.QueryEscape(r.URL.RequestURI())
		}
		if r.Header.Get("HX-Request") == "true" {
			w.Header().Set("HX-Redirect", to)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "sign in first", http.StatusUnauthorized)
			return
		}
		http.Redirect(w, r, to, http.StatusSeeOther)
	})
}

type loginView struct {
	Next  string
	Error string
}

func (wb *web) loginPage(w http.ResponseWriter, r *http.Request) {
	if wb.signedIn(r) {
		http.Redirect(w, r, safeNext(r.URL.Query().Get("next")), http.StatusSeeOther)
		return
	}
	wb.render(w, r, "login", "layout", http.StatusOK,
		page{Title: "Sign in", Body: loginView{Next: r.URL.Query().Get("next")}})
}

func (wb *web) login(w http.ResponseWriter, r *http.Request) {
	next := r.PostFormValue("next")
	if ok, _ := wb.logins.take(clientIP(r), 1, time.Now()); !ok {
		wb.render(w, r, "login", "layout", http.StatusTooManyRequests,
			page{Title: "Sign in", Body: loginView{Next: next, Error: "Too many attempts. Wait a minute and try again."}})
		return
	}
	// Comparing hashes keeps the comparison constant-time regardless of the guess's length.
	given := sha256.Sum256([]byte(r.PostFormValue("password")))
	want := sha256.Sum256([]byte(wb.cfg.AdminPassword))
	if subtle.ConstantTimeCompare(given[:], want[:]) != 1 {
		wb.log.Warn("failed sign-in", "ip", clientIP(r))
		wb.render(w, r, "login", "layout", http.StatusUnauthorized,
			page{Title: "Sign in", Body: loginView{Next: next, Error: "Wrong password."}})
		return
	}

	expires := time.Now().Add(sessionMaxAge)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    wb.signSession(expires.Unix()),
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(sessionMaxAge.Seconds()),
		HttpOnly: true,
		Secure:   wb.cfg.BaseURL.Scheme == "https",
		SameSite: http.SameSiteStrictMode,
	})
	http.Redirect(w, r, safeNext(next), http.StatusSeeOther)
}

func (wb *web) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   wb.cfg.BaseURL.Scheme == "https",
		SameSite: http.SameSiteStrictMode,
	})
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

// safeNext keeps the after-sign-in redirect on this site: a path, never `//host` or `/\host` (which browsers read
// as another host).
func safeNext(next string) string {
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.Contains(next, `\`) {
		return "/"
	}
	return next
}

/*------ Session Cookie ------*/

// signSession returns `<expiry>.<mac>`. There is one user, so the cookie only proves "signed in until expiry". The
// MAC also covers a hash of the password, so changing ADMIN_PASSWORD (or SESSION_SECRET) signs everyone out.
func (wb *web) signSession(expires int64) string {
	exp := strconv.FormatInt(expires, 10)
	return exp + "." + base64.RawURLEncoding.EncodeToString(wb.sessionMAC(exp))
}

func (wb *web) sessionMAC(exp string) []byte {
	password := sha256.Sum256([]byte(wb.cfg.AdminPassword))
	mac := hmac.New(sha256.New, []byte(wb.cfg.SessionSecret))
	mac.Write([]byte("session|" + exp + "|" + hex.EncodeToString(password[:])))
	return mac.Sum(nil)
}

func (wb *web) signedIn(r *http.Request) bool {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	exp, sig, ok := strings.Cut(cookie.Value, ".")
	if !ok {
		return false
	}
	expires, err := strconv.ParseInt(exp, 10, 64)
	if err != nil || time.Now().Unix() > expires {
		return false
	}
	given, err := base64.RawURLEncoding.DecodeString(sig)
	return err == nil && hmac.Equal(given, wb.sessionMAC(exp))
}

/*===== Time Formatting =====*/

func isoTime(ms int64) string {
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

func exactTime(ms int64) string {
	return time.UnixMilli(ms).UTC().Format("2006-01-02 15:04:05 UTC")
}

// ago is a short relative time. app.js keeps it current in the browser and shows the local time on hover.
func ago(ms int64, now time.Time) string {
	d := now.Sub(time.UnixMilli(ms))
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return strconv.Itoa(int(d.Minutes())) + "m ago"
	case d < 24*time.Hour:
		return strconv.Itoa(int(d.Hours())) + "h ago"
	default:
		return strconv.Itoa(int(d.Hours()/24)) + "d ago"
	}
}

/*===== Row Helpers =====*/

// KindLabel is the kind shown in the list: browser events are marked as such, whatever their kind.
func (r eventRow) KindLabel() string {
	if r.Platform == "javascript" && r.Kind != "slow" {
		return "browser"
	}
	return r.Kind
}

// Cursor is the row's position in the list, for paging.
func (r eventRow) Cursor() string {
	return cursor{At: r.ReceivedAt, ID: r.ID}.String()
}
