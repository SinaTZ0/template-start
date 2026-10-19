package main

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
)

/*===== Migrations =====*/

// A database made before client IDs existed must open, keep its events, and store client IDs from then on.
func TestMigrateKeepsVersion1Events(t *testing.T) {
	path := filepath.Join(t.TempDir(), "errors.db")
	old, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	if err := migrateV1(old); err != nil {
		t.Fatal(err)
	}
	_, err = old.Exec(`insert into events (id, received_at, kind, level, title, payload)
		values ('9ec79c33ec9942ab8353589fcb2e04dc', 1, 'error', 'error', 'old', x'')`)
	if err != nil {
		t.Fatal(err)
	}
	old.Close()

	st, err := openStore(path, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.close() })

	newer := eventRow{ID: "1ec79c33ec9942ab8353589fcb2e04dc", ReceivedAt: 2, Kind: "error", Level: "error",
		Title: "new", ClientID: "0f4a9c2e8b7d4e1fa3c5b6d7e8f90a1b", Payload: []byte{}}
	if err := st.insert([]eventRow{newer}); err != nil {
		t.Fatal(err)
	}

	events, _, err := st.list(context.Background(), eventFilter{}, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].ClientID != newer.ClientID || events[1].ClientID != "" {
		t.Errorf("events = %+v", events)
	}
}
