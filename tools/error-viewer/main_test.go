package main

import (
	"strings"
	"testing"
)

// The Sentry SDKs drop a DSN whose key isn't `\w+` without any error, so a key like that must stop the viewer instead.
func TestLoadConfigRejectsKeyTheSDKWouldDrop(t *testing.T) {
	t.Setenv("ADMIN_PASSWORD", "admin")
	t.Setenv("SESSION_SECRET", strings.Repeat("s", 32))
	t.Setenv("ALLOWED_ORIGIN", "http://localhost:5173")
	t.Setenv("BASE_URL", "http://localhost:8000")

	t.Setenv("PUBLIC_KEY", "development-key")
	if _, err := loadConfig(); err == nil || !strings.Contains(err.Error(), "PUBLIC_KEY") {
		t.Errorf("hyphenated key: err = %v", err)
	}

	t.Setenv("PUBLIC_KEY", "developmentkey")
	if _, err := loadConfig(); err != nil {
		t.Errorf("valid key: %v", err)
	}
}
