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
		"tags": {"errorId": "4f1c2b9e-0000-4000-8000-000000000000", "reqId": "638455eb", "method": "GET", "path": "/notes", "module": "orpc",
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
		ErrorID: "4f1c2b9e-0000-4000-8000-000000000000", ReqID: "638455eb", Method: "GET", Path: "/notes",
		Module: "orpc", ClientID: "0f4a9c2e8b7d4e1fa3c5b6d7e8f90a1b",
	}
	if !reflect.DeepEqual(row, want) {
		t.Errorf("row =\n%+v\nwant\n%+v", row, want)
	}
}

func TestBuildRowSlowRequest(t *testing.T) {
	payload := `{
		"message": "Slow request: GET /notes (3012ms)",
		"level": "warning",
		"fingerprint": ["slow-request", "GET", "/notes"],
		"tags": [["route", "/notes"], ["reqId", "638455eb"]]
	}`
	row, err := buildRow([]byte(payload), "9ec79c33ec9942ab8353589fcb2e04dc", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if row.Kind != "slow" || row.Level != "warning" || row.Title != "Slow request: GET /notes (3012ms)" {
		t.Errorf("kind/level/title = %q %q %q", row.Kind, row.Level, row.Title)
	}
	// Tags sent as pairs, and the envelope's ID when the event has none.
	if row.Route != "/notes" || row.ReqID != "638455eb" || row.ID != "9ec79c33ec9942ab8353589fcb2e04dc" {
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
