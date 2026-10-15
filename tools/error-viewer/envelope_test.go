package main

import (
	"strings"
	"testing"
)

func TestParseEnvelopeKeepsEventsOnly(t *testing.T) {
	event := `{"event_id":"aa","message":"one"}`
	body := strings.Join([]string{
		`{"event_id":"9ec79c33ec9942ab8353589fcb2e04dc","sent_at":"2026-10-15T10:00:00Z"}`,
		`{"type":"session"}`,
		`{"sid":"x"}`,
		`{"type":"event","length":` + itoa(len(event)) + `}`,
		event,
		`{"type":"client_report"}`,
		`{"discarded_events":[]}`,
		`{"type":"event"}`,
		`{"message":"two"}`,
		"",
	}, "\n")

	env, err := parseEnvelope([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if env.EventID != "9ec79c33ec9942ab8353589fcb2e04dc" {
		t.Errorf("event id = %q", env.EventID)
	}
	if len(env.Events) != 2 || string(env.Events[0]) != event || string(env.Events[1]) != `{"message":"two"}` {
		t.Errorf("events = %q", env.Events)
	}
}

// A length-delimited payload may itself contain newlines (an attachment), and must not be split at them.
func TestParseEnvelopeHonorsLength(t *testing.T) {
	attachment := "line one\nline two"
	body := "{}\n" +
		`{"type":"attachment","length":` + itoa(len(attachment)) + "}\n" + attachment + "\n" +
		`{"type":"event"}` + "\n" + `{"message":"after"}`

	env, err := parseEnvelope([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if len(env.Events) != 1 || string(env.Events[0]) != `{"message":"after"}` {
		t.Errorf("events = %q", env.Events)
	}
}

func TestParseEnvelopeSkipsMalformedItems(t *testing.T) {
	body := "{}\n" +
		"not json\n{\"message\":\"lost with its header\"}\n" +
		`{"type":"event"}` + "\n" + "{broken\n" +
		`{"type":"event"}` + "\n" + `{"message":"kept"}` + "\n"

	env, err := parseEnvelope([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if len(env.Events) != 1 || string(env.Events[0]) != `{"message":"kept"}` {
		t.Errorf("events = %q", env.Events)
	}
}

func TestParseEnvelopeRejectsBadHeader(t *testing.T) {
	if _, err := parseEnvelope([]byte("hello\n{}")); err == nil {
		t.Error("expected an error")
	}
}
