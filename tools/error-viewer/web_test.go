package main

import (
	"testing"
	"time"
)

/*===== Search =====*/

// A bare reqId is recognized by its shape: a 32-character trace ID now, 16 or 8 for events stored before.
func TestSearchFindsBareReqIDs(t *testing.T) {
	for _, search := range []string{"0AF7651916CD43DD8448EB211C80319C", "638455EB2C7F1A90", "638455eb"} {
		f := listQuery{Q: search}.filter(time.Now())
		if f.Column != "req_id" || f.Text != "" {
			t.Errorf("%q: column %q, text %q", search, f.Column, f.Text)
		}
	}
}

/*===== Trace Link =====*/

// A reqId that is a trace ID links to its trace when TRACE_URL is set; anything else, or no TRACE_URL, links nowhere.
func TestTraceLink(t *testing.T) {
	const traceURL = "https://traces.example.com/web/traces?trace_id={traceId}"
	if got := traceLink(traceURL, "0af7651916cd43dd8448eb211c80319c"); got != "https://traces.example.com/web/traces?trace_id=0af7651916cd43dd8448eb211c80319c" {
		t.Errorf("trace ID: %q", got)
	}
	for _, value := range []string{"638455eb2c7f1a90", "<script>", ""} {
		if got := traceLink(traceURL, value); got != "" {
			t.Errorf("%q: %q", value, got)
		}
	}
	if got := traceLink("", "0af7651916cd43dd8448eb211c80319c"); got != "" {
		t.Errorf("no TRACE_URL: %q", got)
	}
}
