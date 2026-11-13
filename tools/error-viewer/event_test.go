package main

import (
	"reflect"
	"strconv"
	"testing"
	"time"
)

func itoa(n int) string { return strconv.Itoa(n) }

func TestBuildRowServerError(t *testing.T) {
	payload := `{
		"event_id": "9EC79C33-EC99-42AB-8353-589FCB2E04DC",
		"timestamp": 1760522400.5,
		"platform": "node",
		"environment": "production",
		"exception": {"values": [
			{"type": "Error", "value": "connect ECONNREFUSED"},
			{"type": "DrizzleQueryError", "value": "Failed query: select 1\nparams: (hidden)"}
		]},
		"tags": {"errorId": "4f1c2b9e-0000-4000-8000-000000000000", "reqId": "638455eb2c7f1a90", "method": "GET", "path": "/notes", "module": "orpc",
			"clientId": "0f4a9c2e8b7d4e1fa3c5b6d7e8f90a1b"}
	}`
	row, err := buildRow([]byte(payload), "", time.UnixMilli(1000))
	if err != nil {
		t.Fatal(err)
	}

	want := eventRow{
		ID: "9ec79c33ec9942ab8353589fcb2e04dc", ReceivedAt: 1000, OccurredAt: 1760522400500, Kind: "error",
		Level: "error", Platform: "node", Environment: "production",
		// The thrown error is the last value; only its first line.
		Title:   "DrizzleQueryError: Failed query: select 1",
		ErrorID: "4f1c2b9e-0000-4000-8000-000000000000", ReqID: "638455eb2c7f1a90", Method: "GET", Path: "/notes",
		Module: "orpc", ClientID: "0f4a9c2e8b7d4e1fa3c5b6d7e8f90a1b",
	}
	if row.GroupKey == "" {
		t.Error("no group key")
	}
	want.GroupKey = row.GroupKey
	if !reflect.DeepEqual(row, want) {
		t.Errorf("row =\n%+v\nwant\n%+v", row, want)
	}
}

func TestBuildRowSlowRequest(t *testing.T) {
	payload := `{
		"message": "Slow request: GET /notes (3012ms)",
		"level": "warning",
		"fingerprint": ["slow-request", "GET", "/notes"],
		"tags": [["route", "/notes"], ["reqId", "638455eb2c7f1a90"]]
	}`
	row, err := buildRow([]byte(payload), "9ec79c33ec9942ab8353589fcb2e04dc", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if row.Kind != "slow" || row.Level != "warning" || row.Title != "Slow request: GET /notes (3012ms)" {
		t.Errorf("kind/level/title = %q %q %q", row.Kind, row.Level, row.Title)
	}
	// Tags sent as pairs, and the envelope's ID when the event has none.
	if row.Route != "/notes" || row.ReqID != "638455eb2c7f1a90" || row.ID != "9ec79c33ec9942ab8353589fcb2e04dc" {
		t.Errorf("route/reqId/id = %q %q %q", row.Route, row.ReqID, row.ID)
	}
}

func TestBuildRowBrowserError(t *testing.T) {
	payload := `{
		"platform": "javascript",
		"level": "fatal",
		"exception": {"values": [{"type": "TypeError", "value": "x is undefined"}]},
		"request": {"url": "https://example.com/notes/1?token=secret"}
	}`
	row, err := buildRow([]byte(payload), "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if row.Path != "/notes/1" || row.KindLabel() != "browser" || row.Level != "fatal" {
		t.Errorf("path/kind/level = %q %q %q", row.Path, row.KindLabel(), row.Level)
	}
	if len(row.ID) != 32 {
		t.Errorf("expected a random 32-char ID, got %q", row.ID)
	}
}

// `captureMessage` sends its message as a synthetic exception, only to carry a stack.
func TestBuildRowMessageWithSyntheticException(t *testing.T) {
	payload := `{"message": "cache warmed", "level": "info",
		"exception": {"values": [{"value": "cache warmed", "mechanism": {"type": "generic", "synthetic": true}}]}}`
	row, err := buildRow([]byte(payload), "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if row.Kind != "message" || row.Title != "cache warmed" {
		t.Errorf("kind/title = %q %q", row.Kind, row.Title)
	}
}

// The browser SDK carries the signed-in user in `user.id` (`Sentry.setUser`), not in a tag; `userId:` must find both.
func TestBuildRowReadsBrowserUserAndRelease(t *testing.T) {
	payload := `{"platform": "javascript", "message": "x", "release": "1a2b3c4", "user": {"id": "Hq3ZkV9xT2bLwA7mRc5NdY8e"}}`
	row, err := buildRow([]byte(payload), "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if row.UserID != "Hq3ZkV9xT2bLwA7mRc5NdY8e" || row.Release != "1a2b3c4" {
		t.Errorf("userId/release = %q %q", row.UserID, row.Release)
	}
}

// Two reports of one bug differ only in numbers and IDs; another error, or the same one elsewhere, is another group.
func TestGroupKeyJoinsAlikeErrorsOnly(t *testing.T) {
	event := func(message, function string) string {
		return `{"platform": "node", "exception": {"values": [{"type": "Error", "value": "` + message + `",
			"stacktrace": {"frames": [{"filename": "/app/src/orpc/note/service.ts", "function": "` + function + `",
			"lineno": 12, "context_line": "throw"}]}}]}}`
	}
	key := func(payload string) string {
		row, err := buildRow([]byte(payload), "", time.Now())
		if err != nil {
			t.Fatal(err)
		}
		return row.GroupKey
	}

	first := key(event("note 4821 not found for 4f1c2b9e-0000-4000-8000-000000000000", "getNote"))
	if again := key(event("note 77 not found for 9ec79c33-ec99-42ab-8353-589fcb2e04dc", "getNote")); again != first {
		t.Error("the same error with other numbers got another group")
	}
	if other := key(event("note 4821 is locked", "getNote")); other == first {
		t.Error("a different message got the same group")
	}
	if elsewhere := key(event("note 4821 not found for 4f1c2b9e-0000-4000-8000-000000000000", "deleteNote")); elsewhere == first {
		t.Error("the same message thrown elsewhere got the same group")
	}
}
