package pgweb

import (
	"testing"
	"time"
)

// The browser has full access to the database, so it may never be opened for longer than a day.
func TestParseDurationStaysWithinADay(t *testing.T) {
	for text, want := range map[string]time.Duration{"30m": 30 * time.Minute, "4h": 4 * time.Hour, "1d": 24 * time.Hour} {
		if got, err := ParseDuration(text); err != nil || got != want {
			t.Errorf("ParseDuration(%q) = %v, %v", text, got, err)
		}
	}
	for _, text := range []string{"25h", "2d", "30s", "0", "-1h", "soon"} {
		if _, err := ParseDuration(text); err == nil {
			t.Errorf("ParseDuration(%q) accepted it", text)
		}
	}
}
