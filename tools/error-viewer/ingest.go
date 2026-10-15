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
)

func newIngest(s *store, cfg config, log *slog.Logger) *ingest {
	return &ingest{
		store:          s,
		projectID:      cfg.ProjectID,
		publicKey:      cfg.PublicKey,
		allowedOrigins: parseOrigins(cfg.AllowedOrigin),
		perIP:          newRateLimiter(ingestPerIPPerMinute, ingestPerIPBurst),
		global:         newRateLimiter(ingestGlobalPerMinute, ingestGlobalBurst),
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

	// Sessions, client reports and the like are accepted and dropped, and don't count against the rate limit: the
	// browser SDK sends a session on every page load.
	if len(env.Events) == 0 {
		writeJSON(w, http.StatusOK, map[string]string{"id": normalizeEventID(env.EventID)})
		return
	}

	/*------ Rate Limit ------*/
	now := time.Now()
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
		row, err := buildRow(payload, fallbackID, now)
		if err != nil {
			h.log.Warn("skipped an unreadable event", "err", err)
			continue
		}
		row.Payload = compressPayload(payload)
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
