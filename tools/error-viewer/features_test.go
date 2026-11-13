package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testStore(t *testing.T) *store {
	t.Helper()
	st, err := openStore(filepath.Join(t.TempDir(), "errors.db"), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.close() })
	return st
}

func testRow(id byte, receivedAt int64, payloadBytes int) eventRow {
	return eventRow{ID: strings.Repeat(string([]byte{'a' + id}), 32), ReceivedAt: receivedAt, Kind: "error", Level: "error",
		Title: "boom", Payload: make([]byte, payloadBytes)}
}

/*===== Retention =====*/

func TestPruneKeepsByAgeCountAndSize(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	now := time.UnixMilli(1_000_000_000)
	day := 24 * time.Hour
	stored := func() []string {
		events, _, err := st.list(ctx, eventFilter{}, nil, 100)
		if err != nil {
			t.Fatal(err)
		}
		ids := make([]string, len(events))
		for i, event := range events {
			ids[i] = event.ID[:1]
		}
		return ids
	}

	// a is too old; b to e are an hour apart, newest last.
	rows := []eventRow{testRow(0, now.Add(-40*day).UnixMilli(), 10)}
	for i := byte(1); i <= 4; i++ {
		rows = append(rows, testRow(i, now.Add(time.Duration(i)*time.Hour-day).UnixMilli(), 10))
	}
	if err := st.insert(rows); err != nil {
		t.Fatal(err)
	}

	if _, err := st.prune(ctx, retention{MaxAge: 30 * day, MaxEvents: 3}, now); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(stored(), ""); got != "edc" {
		t.Errorf("after age and count: %q, want the newest three (edc)", got)
	}

	/*------ Size ------*/
	// Incompressible to SQLite (it stores the blob as given), so the file must grow by about this much.
	big := make([]eventRow, 0, 20)
	for i := byte(5); i < 25; i++ {
		big = append(big, testRow(i, now.Add(time.Duration(i)*time.Minute).UnixMilli(), 256<<10))
	}
	if err := st.insert(big); err != nil {
		t.Fatal(err)
	}
	const limit = 2 << 20
	if _, err := st.prune(ctx, retention{MaxAge: 30 * day, MaxEvents: 1000, MaxBytes: limit}, now); err != nil {
		t.Fatal(err)
	}
	used, err := st.usedBytes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	left := stored()
	if used > limit || len(left) == 0 || left[0] != "y" {
		t.Errorf("after the size cap: %d bytes used (limit %d), stored %v; want under the limit with the newest kept", used, limit, left)
	}
}

// One row SQLite refuses must not take the rest of its batch with it: the events were already accepted.
func TestInsertAllKeepsTheRowsThatCanBeStored(t *testing.T) {
	st := testStore(t)
	refused := testRow(1, 2, 0)
	refused.Payload = nil // `payload` is not null
	st.insertAll([]eventRow{testRow(0, 1, 10), refused, testRow(2, 3, 10)})

	events, _, err := st.list(context.Background(), eventFilter{}, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Errorf("stored %d events, want the 2 that can be stored", len(events))
	}
}

/*===== Size Cap =====*/

func TestTrimPayloadDropsTheLargestFields(t *testing.T) {
	small := []byte(`{"message":"boom"}`)
	if string(trimPayload(small)) != string(small) {
		t.Error("an event under the cap was changed")
	}

	huge := `{"message":"boom","extra":{"dump":"` + strings.Repeat("x", maxEventBytes) + `"},"tags":{"path":"/notes"}}`
	trimmed := trimPayload([]byte(huge))
	ev, err := decodeEvent(trimmed)
	if err != nil {
		t.Fatal(err)
	}
	if len(trimmed) > maxEventBytes || ev.message() != "boom" || ev.tags()["path"] != "/notes" {
		t.Errorf("trimmed to %d bytes, message %q, tags %v", len(trimmed), ev.message(), ev.tags())
	}
	if ev.Trimmed == nil || ev.Trimmed.Bytes != len(huge) || len(ev.Trimmed.Dropped) != 1 || ev.Trimmed.Dropped[0] != "extra" {
		t.Errorf("trimmed note = %+v", ev.Trimmed)
	}
}

/*===== Groups =====*/

func TestGroupedListCountsAlikeEvents(t *testing.T) {
	st := testStore(t)
	rows := []eventRow{testRow(0, 1, 1), testRow(1, 2, 1), testRow(2, 3, 1), testRow(3, 4, 1)}
	rows[0].GroupKey, rows[1].GroupKey, rows[3].GroupKey = strings.Repeat("1", 32), strings.Repeat("2", 32), strings.Repeat("1", 32)
	rows[3].Title = "newest of group 1"
	if err := st.insert(rows); err != nil {
		t.Fatal(err)
	}

	groups, more, err := st.groups(context.Background(), eventFilter{}, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	// Group 1 (two events, newest last seen), the event without a group, then group 2.
	if more || len(groups) != 3 {
		t.Fatalf("groups = %+v", groups)
	}
	first := groups[0]
	if first.Count != 2 || first.Title != "newest of group 1" || first.ReceivedAt != 4 || first.FirstAt != 1 {
		t.Errorf("first group = %+v", first)
	}
	if groups[1].Count != 1 || groups[1].ID != rows[2].ID || groups[2].GroupKey != rows[1].GroupKey {
		t.Errorf("other groups = %+v", groups[1:])
	}

	// Paging continues after the last group shown.
	page, more, err := st.groups(context.Background(), eventFilter{}, nil, 1)
	if err != nil || !more || len(page) != 1 {
		t.Fatalf("first page = %+v, more %v, err %v", page, more, err)
	}
	next, _, err := st.groups(context.Background(), eventFilter{}, &cursor{At: page[0].ReceivedAt, ID: page[0].Key()}, 10)
	if err != nil || len(next) != 2 {
		t.Errorf("second page = %+v, err %v", next, err)
	}
}

/*===== Source Maps =====*/

// Built line 1: column 0 is source line 1; from column 5 on is source line 3, column 2, the identifier `saveNote`.
const testSourceMap = `{"version":3,"sources":["../../src/routes/notes/notes.tsx"],
	"sourcesContent":["line one\nline two\n  throw new Error('x')\nline four"],
	"names":["saveNote"],"mappings":"AAAA,KAECA"}`

func TestSymbolicatorMapsBrowserFrames(t *testing.T) {
	var mu sync.Mutex
	var asked []string
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		asked = append(asked, r.URL.Path)
		mu.Unlock()
		if r.URL.Path != "/assets/index-abc123.js.map" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(testSourceMap))
	}))
	defer app.Close()
	origin, _ := url.Parse(app.URL)
	maps := newSymbolicator(origin, slog.New(slog.NewTextHandler(io.Discard, nil)))

	payload := `{"platform":"javascript","timestamp":1760522400.5,"exception":{"values":[{"type":"Error","value":"x",
		"stacktrace":{"frames":[
			{"filename":"https://example.com/rpc/note/list?secret=1","function":"q","lineno":1,"colno":1},
			{"filename":"https://example.com/assets/index-abc123.js","function":"a","lineno":1,"colno":8},
			{"filename":"https://example.com/assets/index-abc123.js","function":"b","lineno":1,"colno":8}]}}]}}`
	mapped := maps.apply([]byte(payload))

	ev, err := decodeEvent(mapped)
	if err != nil {
		t.Fatal(err)
	}
	frames := ev.exceptions()[0].Stacktrace.Frames
	inner := frames[2]
	if inner.Filename != "src/routes/notes/notes.tsx" || *inner.Lineno != 3 || *inner.Colno != 2 ||
		inner.ContextLine == nil || *inner.ContextLine != "  throw new Error('x')" || len(inner.PreContext) != 2 {
		t.Errorf("mapped frame = %+v", inner)
	}
	// The identifier at the caller's position names the frame it called.
	if inner.Function != "saveNote" {
		t.Errorf("function = %q, want saveNote", inner.Function)
	}
	if ev.occurredAt() != 1760522400500 {
		t.Errorf("the rest of the event changed: timestamp %d", ev.occurredAt())
	}

	// A frame can't make the viewer ask the app for anything but a `.js.map`.
	mu.Lock()
	defer mu.Unlock()
	for _, path := range asked {
		if !strings.HasSuffix(path, ".js.map") {
			t.Errorf("the viewer asked the app for %s", path)
		}
	}

	if untouched := maps.apply([]byte(`{"platform":"node","message":"javascript"}`)); string(untouched) != `{"platform":"node","message":"javascript"}` {
		t.Error("a server event was rewritten")
	}
}

/*===== Notifications =====*/

// A kind of error is announced when it first shows up, not for every event of it.
func TestNotifierAnnouncesANewKindOfErrorOnce(t *testing.T) {
	var mu sync.Mutex
	var texts []string
	chat := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text   string `json:"text"`
			ChatID string `json:"chat_id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		texts = append(texts, body.ChatID+"|"+body.Text)
		mu.Unlock()
	}))
	defer chat.Close()

	server, st := newTestServer(t, func(cfg *config) {
		cfg.NotifyURL, _ = url.Parse(chat.URL)
		cfg.NotifyChatID = "42"
	})
	send := func(id, message, level string) {
		envelope := "{}\n{\"type\":\"event\"}\n" + `{"event_id":"` + id + `","environment":"production","level":"` + level +
			`","exception":{"values":[{"type":"Error","value":"` + message + `"}]}}` + "\n"
		postEnvelope(t, server, "/api/1/envelope/?sentry_key="+testKey, envelope)
	}
	send("1ec79c33ec9942ab8353589fcb2e04dc", "note 1 not found", "error")
	waitForEvents(t, st, 1)
	send("2ec79c33ec9942ab8353589fcb2e04dc", "note 2 not found", "error")
	send("3ec79c33ec9942ab8353589fcb2e04dc", "storage is down", "error")
	send("4ec79c33ec9942ab8353589fcb2e04dc", "slow thing", "warning")
	waitForEvents(t, st, 4)

	deadline := time.Now().Add(2 * time.Second)
	for {
		mu.Lock()
		count := len(texts)
		mu.Unlock()
		if count >= 2 || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(50 * time.Millisecond) // a third message, if one were wrongly on its way
	mu.Lock()
	defer mu.Unlock()
	if len(texts) != 2 {
		t.Fatalf("%d notifications, want 2 (one per new kind of error): %q", len(texts), texts)
	}
	want := "42|[production] Error: note 1 not found"
	if !strings.HasPrefix(texts[0], want) || !strings.Contains(texts[0], "http://localhost:8000/events/1ec79c33ec9942ab8353589fcb2e04dc") {
		t.Errorf("first notification = %q", texts[0])
	}
	if !strings.Contains(texts[1], "storage is down") {
		t.Errorf("second notification = %q", texts[1])
	}
}
