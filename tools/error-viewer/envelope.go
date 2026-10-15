package main

import (
	"bytes"
	"encoding/json"
	"errors"
)

/*===== Envelope Parsing =====*/

// envelope is what the viewer keeps from one Sentry envelope: its header's event ID and the payloads of its `event`
// items. Every other item type (sessions, client reports, transactions, attachments…) is dropped.
type envelope struct {
	EventID string
	Events  []json.RawMessage
}

var errBadEnvelopeHeader = errors.New("envelope header is not a JSON object")

// parseEnvelope reads Sentry's newline-delimited envelope format:
//
//	{envelope header}\n
//	{item header}\n{payload}\n
//	{item header}\n{payload}\n …
//
// An item header may give its payload's `length` in bytes; without one the payload runs to the next newline. A
// malformed item is skipped and parsing goes on with the next one, so one bad item never loses the others. Only a
// missing or unparseable envelope header is an error.
func parseEnvelope(body []byte) (envelope, error) {
	var env envelope

	/*------ Envelope Header ------*/
	line, rest := cutLine(body)
	var header struct {
		EventID string `json:"event_id"`
	}
	if err := json.Unmarshal(line, &header); err != nil {
		return env, errBadEnvelopeHeader
	}
	env.EventID = header.EventID

	/*------ Items ------*/
	for len(rest) > 0 {
		line, rest = cutLine(rest)
		if len(bytes.TrimSpace(line)) == 0 {
			continue // a trailing newline, or blank lines between items
		}

		var item struct {
			Type   string `json:"type"`
			Length *int   `json:"length"`
		}
		if err := json.Unmarshal(line, &item); err != nil {
			// Without a header the payload's size is unknown. Assume the common shape (payload on the next line) and
			// skip it too.
			_, rest = cutLine(rest)
			continue
		}

		var payload []byte
		if item.Length != nil {
			n := *item.Length
			if n < 0 || n > len(rest) {
				break // a length past the end: nothing after it can be located
			}
			payload, rest = rest[:n], rest[n:]
			// The payload is followed by a newline, unless it ends the envelope.
			if len(rest) > 0 && rest[0] == '\n' {
				rest = rest[1:]
			}
		} else {
			payload, rest = cutLine(rest)
		}

		if item.Type != "event" || !json.Valid(payload) {
			continue
		}
		env.Events = append(env.Events, json.RawMessage(payload))
	}
	return env, nil
}

// cutLine splits b at its first newline, dropping the newline and a `\r` before it.
func cutLine(b []byte) (line, rest []byte) {
	line, rest, _ = bytes.Cut(b, []byte{'\n'})
	return bytes.TrimSuffix(line, []byte{'\r'}), rest
}
