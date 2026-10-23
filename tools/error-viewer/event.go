package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

/*===== Event JSON =====*/

// sentryEvent holds the parts of a Sentry event the viewer reads. Fields whose shape varies between SDKs and protocol
// versions stay raw and are decoded by the helpers below.
type sentryEvent struct {
	EventID     string                     `json:"event_id"`
	Timestamp   json.RawMessage            `json:"timestamp"`
	Level       string                     `json:"level"`
	Platform    string                     `json:"platform"`
	Environment string                     `json:"environment"`
	Message     json.RawMessage            `json:"message"`
	Logentry    *messageObject             `json:"logentry"`
	Exception   json.RawMessage            `json:"exception"`
	Fingerprint []json.RawMessage          `json:"fingerprint"`
	Tags        json.RawMessage            `json:"tags"`
	Request     *eventRequest              `json:"request"`
	Contexts    map[string]json.RawMessage `json:"contexts"`
}

type messageObject struct {
	Formatted string `json:"formatted"`
	Message   string `json:"message"`
}

type eventRequest struct {
	URL    string `json:"url"`
	Method string `json:"method"`
}

type exception struct {
	Type       string      `json:"type"`
	Value      string      `json:"value"`
	Module     string      `json:"module"`
	Mechanism  *mechanism  `json:"mechanism"`
	Stacktrace *stacktrace `json:"stacktrace"`
}

type mechanism struct {
	Type      string `json:"type"`
	Handled   *bool  `json:"handled"`
	Synthetic bool   `json:"synthetic"`
}

type stacktrace struct {
	Frames []frame `json:"frames"`
}

type frame struct {
	Function    string   `json:"function"`
	Module      string   `json:"module"`
	Filename    string   `json:"filename"`
	AbsPath     string   `json:"abs_path"`
	Lineno      *int     `json:"lineno"`
	Colno       *int     `json:"colno"`
	InApp       *bool    `json:"in_app"`
	PreContext  []string `json:"pre_context"`
	ContextLine *string  `json:"context_line"`
	PostContext []string `json:"post_context"`
}

// decodeEvent reads an event payload. A field of an unexpected type is left empty rather than failing the whole event
// (encoding/json fills the rest and reports the first mismatch, which is ignored here).
func decodeEvent(payload []byte) (sentryEvent, error) {
	var ev sentryEvent
	err := json.Unmarshal(payload, &ev)
	var typeErr *json.UnmarshalTypeError
	if err != nil && !errors.As(err, &typeErr) {
		return ev, err
	}
	return ev, nil
}

// exceptions returns the event's exceptions in the SDK's order: the oldest cause first, the thrown error last. The
// protocol allows `{"values": [...]}` and, in old SDKs, a bare list.
func (ev sentryEvent) exceptions() []exception {
	if len(ev.Exception) == 0 {
		return nil
	}
	var wrapped struct {
		Values []exception `json:"values"`
	}
	if json.Unmarshal(ev.Exception, &wrapped) == nil {
		return wrapped.Values
	}
	var list []exception
	if json.Unmarshal(ev.Exception, &list) == nil {
		return list
	}
	return nil
}

// tags returns the event's tags. SDKs send them as an object or as a list of `[key, value]` pairs.
func (ev sentryEvent) tags() map[string]string {
	tags := map[string]string{}
	if len(ev.Tags) == 0 {
		return tags
	}

	var object map[string]json.RawMessage
	if json.Unmarshal(ev.Tags, &object) == nil {
		for key, value := range object {
			tags[key] = jsonText(value)
		}
		return tags
	}

	var pairs [][]json.RawMessage
	if json.Unmarshal(ev.Tags, &pairs) == nil {
		for _, pair := range pairs {
			if len(pair) != 2 {
				continue
			}
			var key string
			if json.Unmarshal(pair[0], &key) == nil {
				tags[key] = jsonText(pair[1])
			}
		}
	}
	return tags
}

// message returns the event's message: a string, or an object with `formatted` / `message`, or `logentry`.
func (ev sentryEvent) message() string {
	if len(ev.Message) > 0 {
		var text string
		if json.Unmarshal(ev.Message, &text) == nil && text != "" {
			return text
		}
		var object messageObject
		if json.Unmarshal(ev.Message, &object) == nil {
			if object.Formatted != "" {
				return object.Formatted
			}
			if object.Message != "" {
				return object.Message
			}
		}
	}
	if ev.Logentry != nil {
		if ev.Logentry.Formatted != "" {
			return ev.Logentry.Formatted
		}
		return ev.Logentry.Message
	}
	return ""
}

// occurredAt reads `timestamp`: seconds since the epoch (with a fraction) or an RFC 3339 string. Returns 0 when it is
// missing or unreadable.
func (ev sentryEvent) occurredAt() int64 {
	if len(ev.Timestamp) == 0 {
		return 0
	}
	var seconds float64
	if json.Unmarshal(ev.Timestamp, &seconds) == nil && seconds > 0 && seconds < math.MaxInt64/1000 {
		return int64(seconds * 1000)
	}
	var text string
	if json.Unmarshal(ev.Timestamp, &text) == nil {
		if t, err := time.Parse(time.RFC3339Nano, text); err == nil {
			return t.UnixMilli()
		}
	}
	return 0
}

/*===== Row Columns =====*/

// eventRow is one stored event. The columns exist to list, filter and search; `Payload` (the gzipped event JSON) is
// what the detail page reads.
type eventRow struct {
	ID          string
	ReceivedAt  int64
	OccurredAt  int64
	Kind        string
	Level       string
	Platform    string
	Environment string
	Title       string
	ErrorID     string
	ReqID       string
	Method      string
	Path        string
	Route       string
	Module      string
	ClientID    string // the browser's random ID (src/lib/client-id.ts), shared by its own and its requests' events
	UserID      string // the signed-in user's database ID, on the server's and the browser's events
	Payload     []byte
}

const (
	titleMaxLen  = 200
	columnMaxLen = 500
)

// buildRow turns an event payload into its row columns. `fallbackID` (the envelope header's event_id) is used when the
// event has none; with neither, a random ID is made. The payload itself is set by the caller.
func buildRow(payload []byte, fallbackID string, receivedAt time.Time) (eventRow, error) {
	ev, err := decodeEvent(payload)
	if err != nil {
		return eventRow{}, err
	}
	tags := ev.tags()
	exceptions := ev.exceptions()

	row := eventRow{
		ID:          normalizeEventID(ev.EventID),
		ReceivedAt:  receivedAt.UnixMilli(),
		OccurredAt:  ev.occurredAt(),
		Kind:        eventKind(ev, exceptions),
		Level:       normalizeLevel(ev.Level),
		Platform:    clip(ev.Platform, 32),
		Environment: clip(ev.Environment, 64),
		Title:       eventTitle(ev, exceptions),
		ErrorID:     clip(tags["errorId"], columnMaxLen),
		ReqID:       clip(tags["reqId"], columnMaxLen),
		Method:      clip(tags["method"], 16),
		Path:        clip(tags["path"], columnMaxLen),
		Route:       clip(tags["route"], columnMaxLen),
		Module:      clip(tags["module"], columnMaxLen),
		ClientID:    clip(tags["clientId"], 64),
		UserID:      clip(tags["userId"], 64),
	}

	/*------ Browser Events ------*/
	// The browser SDK has no request tags; its page URL is in `request`.
	if ev.Request != nil {
		if row.Path == "" {
			if u, err := url.Parse(ev.Request.URL); err == nil {
				row.Path = clip(u.Path, columnMaxLen)
			}
		}
		if row.Method == "" {
			row.Method = clip(ev.Request.Method, 16)
		}
	}

	/*------ ID ------*/
	if row.ID == "" {
		row.ID = normalizeEventID(fallbackID)
	}
	if row.ID == "" {
		row.ID = randomEventID()
	}
	return row, nil
}

// eventKind is `slow` for the app's slow-request reports (fingerprint `["slow-request", method, route]`), `error` for
// anything with a real exception, and `message` otherwise. `captureMessage` attaches a synthetic exception (only to
// carry the call's stack), which doesn't make it an error.
func eventKind(ev sentryEvent, exceptions []exception) string {
	if len(ev.Fingerprint) > 0 {
		var first string
		if json.Unmarshal(ev.Fingerprint[0], &first) == nil && first == "slow-request" {
			return "slow"
		}
	}
	for _, ex := range exceptions {
		if ex.Mechanism == nil || !ex.Mechanism.Synthetic {
			return "error"
		}
	}
	return "message"
}

// eventTitle is the thrown error (the last exception; earlier ones are its causes) as `Type: value`, or the message.
// First line only, at most 200 characters.
func eventTitle(ev sentryEvent, exceptions []exception) string {
	var title string
	if len(exceptions) > 0 {
		thrown := exceptions[len(exceptions)-1]
		switch {
		case thrown.Type != "" && thrown.Value != "":
			title = thrown.Type + ": " + thrown.Value
		case thrown.Type != "":
			title = thrown.Type
		default:
			title = thrown.Value
		}
	}
	if strings.TrimSpace(title) == "" {
		title = ev.message()
	}

	title, _, _ = strings.Cut(strings.TrimSpace(title), "\n")
	title = strings.TrimSpace(title)
	if title == "" {
		return "(no message)"
	}
	return clip(title, titleMaxLen)
}

var knownLevels = map[string]string{
	"fatal": "fatal", "error": "error", "warning": "warning", "warn": "warning", "info": "info", "log": "info",
	"debug": "debug",
}

// normalizeLevel maps the SDK's level onto fatal / error / warning / info / debug. Sentry treats a missing level as
// `error`, and so does the viewer with an unknown one.
func normalizeLevel(level string) string {
	if known, ok := knownLevels[strings.ToLower(level)]; ok {
		return known
	}
	return "error"
}

// normalizeEventID returns the ID as 32 lowercase hex characters (SDKs send it with or without UUID dashes), or ""
// when it isn't one. The ID ends up in URLs, so nothing else is accepted.
func normalizeEventID(id string) string {
	id = strings.ToLower(strings.ReplaceAll(id, "-", ""))
	if len(id) != 32 {
		return ""
	}
	if _, err := hex.DecodeString(id); err != nil {
		return ""
	}
	return id
}

func randomEventID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

/*===== Helpers =====*/

// jsonText returns a JSON string's value, or any other JSON value as its source text.
func jsonText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	return string(raw)
}

// clip cuts s to at most limit characters without splitting a UTF-8 sequence.
func clip(s string, limit int) string {
	if utf8.RuneCountInString(s) <= limit {
		return s
	}
	runes := []rune(s)
	return string(runes[:limit-1]) + "…"
}
