package main

import (
	"testing"
	"time"
)

/*===== Search =====*/

// A bare reqId is recognized by its shape: 16 hex characters now, 8 for events stored before reqIds grew.
func TestSearchFindsBareReqIDs(t *testing.T) {
	for _, search := range []string{"638455EB2C7F1A90", "638455eb"} {
		f := listQuery{Q: search}.filter(time.Now())
		if f.Column != "req_id" || f.Text != "" {
			t.Errorf("%q: column %q, text %q", search, f.Column, f.Text)
		}
	}
}
