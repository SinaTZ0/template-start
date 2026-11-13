package main

import (
	"compress/gzip"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

/*===== Ingest Endpoint =====*/

// ingest receives Sentry envelopes at `POST /api/{projectId}/envelope/`, the endpoint the app's SDKs post to. It
// checks the project and key, limits size and rate, keeps the `event` items and queues them for the writer.
type ingest struct {
	store          *store
	projectID      string
	publicKey      string
	allowedOrigins map[string]bool
	perIP          *rateLimiter
	global         *rateLimiter
	requests       *rateLimiter
	maps           *symbolicator // nil without SOURCEMAP_ORIGIN
	log            *slog.Logger
}

const (
	maxBodyBytes = 1 << 20
	// Per client: a browser stuck in a render loop gets 20 events, then one a second.
	ingestPerIPPerMinute = 60
	ingestPerIPBurst     = 20
	// For everyone together, so many clients can't fill the disk either.
	ingestGlobalPerMinute = 600
	ingestGlobalBurst     = 100
	// Requests per client, whatever they carry, counted before the body is read. Looser than the event limit: the
	// browser SDK also sends a session on every page load, and an office shares one address.
	ingestRequestsPerMinute = 240
	ingestRequestsBurst     = 120
	// The largest event stored, as JSON before compression. An ordinary event is 5 to 50 KB; a larger one is trimmed
	// (trimPayload).
	maxEventBytes = 256 << 10
)

func newIngest(s *store, cfg config, log *slog.Logger) *ingest {
	var maps *symbolicator
	if cfg.SourcemapOrigin != nil {
		maps = newSymbolicator(cfg.SourcemapOrigin, log)
	}
	return &ingest{
		store:          s,
		projectID:      cfg.ProjectID,
		publicKey:      cfg.PublicKey,
		allowedOrigins: parseOrigins(cfg.AllowedOrigin),
		perIP:          newRateLimiter(ingestPerIPPerMinute, ingestPerIPBurst),
		global:         newRateLimiter(ingestGlobalPerMinute, ingestGlobalBurst),
		requests:       newRateLimiter(ingestRequestsPerMinute, ingestRequestsBurst),
		maps:           maps,
		log:            log,
	}
}

func (h *ingest) routes(mux *http.ServeMux) {
	mux.HandleFunc("OPTIONS /api/{projectId}/envelope/{$}", h.preflight)
	mux.HandleFunc("POST /api/{projectId}/envelope/{$}", h.receive)
}

// preflight answers the browser's CORS preflight. The browser SDK usually avoids one (it sends the key in the query
// string and a plain content type), but a custom transport may not.
func (h *ingest) preflight(w http.ResponseWriter, r *http.Request) {
	h.corsHeaders(w, r)
	w.Header().Set("Access-Control-Allow-Methods", "POST")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Encoding, X-Sentry-Auth")
	w.Header().Set("Access-Control-Max-Age", "86400")
	w.WriteHeader(http.StatusNoContent)
}

// corsHeaders allows the request's origin when it is one of ALLOWED_ORIGIN's. The header holds a single origin, so
// with several allowed the matching one is echoed back.
func (h *ingest) corsHeaders(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); h.allowedOrigins[origin] {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}
	w.Header().Set("Access-Control-Expose-Headers", "Retry-After, X-Sentry-Rate-Limits")
	w.Header().Add("Vary", "Origin")
}

func (h *ingest) receive(w http.ResponseWriter, r *http.Request) {
	h.corsHeaders(w, r)

	/*------ Project and Key ------*/
	if r.PathValue("projectId") != h.projectID {
		jsonError(w, http.StatusNotFound, "unknown project")
		return
	}
	if !h.validKey(r) {
		jsonError(w, http.StatusUnauthorized, "invalid key")
		return
	}

	/*------ Request Limit ------*/
	// Before the body: reading, unzipping and parsing it is the costly part, and an envelope without events never
	// reaches the event limit below.
	now := time.Now()
	if ok, wait := h.requests.take(clientIP(r), 1, now); !ok {
		tooManyRequests(w, wait)
		return
	}

	/*------ Body ------*/
	body, status, err := readBody(w, r)
	if err != nil {
		jsonError(w, status, err.Error())
		return
	}
	env, err := parseEnvelope(body)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Sessions, client reports and the like are accepted and dropped, and don't count against the event limit: the
	// browser SDK sends a session on every page load.
	if len(env.Events) == 0 {
		writeJSON(w, http.StatusOK, map[string]string{"id": normalizeEventID(env.EventID)})
		return
	}

	/*------ Event Limit ------*/
	if ok, wait := h.perIP.take(clientIP(r), len(env.Events), now); !ok {
		tooManyRequests(w, wait)
		return
	}
	if ok, wait := h.global.take("", len(env.Events), now); !ok {
		tooManyRequests(w, wait)
		return
	}

	/*------ Queue ------*/
	var firstID string
	for i, payload := range env.Events {
		// The envelope's event_id belongs to its (usually only) event; a second event without one gets a random ID
		// rather than the same one, which the dedupe would drop.
		fallbackID := ""
		if i == 0 {
			fallbackID = env.EventID
		}
		// A browser's minified frames are mapped to the source first, so the row's group is the source's.
		if h.maps != nil {
			payload = h.maps.apply(payload)
		}
		row, err := buildRow(payload, fallbackID, now)
		if err != nil {
			h.log.Warn("skipped an unreadable event", "err", err)
			continue
		}
		row.Payload = compressPayload(trimPayload(payload))
		if !h.store.enqueue(row) {
			h.log.Warn("event queue full, rejecting events")
			tooManyRequests(w, 10*time.Second)
			return
		}
		if firstID == "" {
			firstID = row.ID
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": firstID})
}

// validKey checks the DSN key, sent in `X-Sentry-Auth: Sentry sentry_key=<key>, …` or as the `sentry_key` query
// parameter (the browser SDK's way, which avoids a CORS preflight). Compared in constant time.
func (h *ingest) validKey(r *http.Request) bool {
	key := r.URL.Query().Get("sentry_key")
	if auth := r.Header.Get("X-Sentry-Auth"); auth != "" {
		auth = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(auth), "Sentry"))
		for part := range strings.SplitSeq(auth, ",") {
			name, value, _ := strings.Cut(strings.TrimSpace(part), "=")
			if name == "sentry_key" {
				key = value
			}
		}
	}
	return key != "" && subtle.ConstantTimeCompare([]byte(key), []byte(h.publicKey)) == 1
}

// parseOrigins reads ALLOWED_ORIGIN: one origin, or several separated by commas.
func parseOrigins(list string) map[string]bool {
	origins := map[string]bool{}
	for origin := range strings.SplitSeq(list, ",") {
		if origin = strings.TrimSuffix(strings.TrimSpace(origin), "/"); origin != "" {
			origins[origin] = true
		}
	}
	return origins
}

/*------ Body ------*/

var (
	errTooLarge            = errors.New("body too large")
	errUnsupportedEncoding = errors.New("unsupported content encoding")
)

// readBody reads at most maxBodyBytes from the wire and, for a gzipped body (the node SDK's larger envelopes), at
// most maxPayloadBytes after decompression, so a small zip bomb can't expand into memory.
func readBody(w http.ResponseWriter, r *http.Request) ([]byte, int, error) {
	raw := http.MaxBytesReader(w, r.Body, maxBodyBytes)

	var reader io.Reader
	switch strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Encoding"))) {
	case "", "identity":
		reader = raw
	case "gzip":
		gz, err := gzip.NewReader(raw)
		if err != nil {
			return nil, statusForReadError(err), err
		}
		defer gz.Close()
		reader = gz
	default:
		return nil, http.StatusUnsupportedMediaType, errUnsupportedEncoding
	}

	body, err := io.ReadAll(io.LimitReader(reader, maxPayloadBytes+1))
	if err != nil {
		return nil, statusForReadError(err), err
	}
	if len(body) > maxPayloadBytes {
		return nil, http.StatusRequestEntityTooLarge, errTooLarge
	}
	return body, 0, nil
}

func statusForReadError(err error) int {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return http.StatusRequestEntityTooLarge
	}
	return http.StatusBadRequest
}

/*------ Size Cap ------*/

// trimmedInfo is the note trimPayload leaves in an event it cut down, shown on the detail page.
type trimmedInfo struct {
	Bytes   int      `json:"bytes"`
	Dropped []string `json:"dropped"`
}

// trimPayload returns an event of at most maxEventBytes. A larger one loses its largest top-level fields, one at a
// time, until it fits; what was dropped is recorded under `viewer_trimmed`. The row's columns are built from the whole
// event before this, so a trimmed event is still found by search.
func trimPayload(payload []byte) []byte {
	if len(payload) <= maxEventBytes {
		return payload
	}
	info := trimmedInfo{Bytes: len(payload)}
	var fields map[string]json.RawMessage
	if json.Unmarshal(payload, &fields) != nil {
		fields = map[string]json.RawMessage{}
	}

	size := len(payload)
	for size > maxEventBytes-1024 && len(fields) > 0 {
		largest := ""
		for key, value := range fields {
			if largest == "" || len(value) > len(fields[largest]) {
				largest = key
			}
		}
		size -= len(fields[largest])
		delete(fields, largest)
		info.Dropped = append(info.Dropped, largest)
	}
	fields["viewer_trimmed"], _ = json.Marshal(info)
	trimmed, err := json.Marshal(fields)
	if err != nil {
		return []byte(`{}`)
	}
	return trimmed
}

/*------ Responses ------*/

// tooManyRequests tells the SDK to back off. Sentry SDKs honor Retry-After and stop sending until it passes.
func tooManyRequests(w http.ResponseWriter, wait time.Duration) {
	seconds := strconv.Itoa(int(wait.Round(time.Second).Seconds()))
	w.Header().Set("Retry-After", seconds)
	jsonError(w, http.StatusTooManyRequests, "rate limited")
}

func jsonError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"detail": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
