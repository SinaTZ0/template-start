package envfile

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"deploy/internal/settings"
)

/*===== Applied State =====*/
// A fingerprint of what Compose reads from .env: the sorted KEY=value pairs of the stack keys, so comments, order,
// spacing and the backup settings never count as a change. Every deploy records it with its time in .env.applied;
// when .env's differs, an edit is waiting for Apply.

// StackKeys are the keys Compose reads, sorted: the registry's stack keys, plus example keys the registry misses.
func StackKeys(ex Example) []string {
	var keys []string
	for _, s := range settings.Registry {
		if s.Scope == settings.Stack {
			keys = append(keys, s.Key)
		}
	}
	for _, key := range ex.Keys {
		if _, known := settings.Lookup(key); !known {
			keys = append(keys, key)
		}
	}
	slices.Sort(keys)
	return slices.Compact(keys)
}

// Fingerprint hashes the stack keys' values in content.
func Fingerprint(content string, keys []string) string {
	values := Parse(content)
	var b strings.Builder
	for _, key := range keys {
		fmt.Fprintf(&b, "%s=%s\n", key, values[key])
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

// Fingerprint is .env's current fingerprint.
func (s *Settings) Fingerprint() string {
	return Fingerprint(Read(s.Env), StackKeys(ReadExample(s.Example)))
}

// RecordApplied writes the fingerprint taken before a deploy started (so an edit made during the build stays pending),
// or the current one when it's empty.
func (s *Settings) RecordApplied(fingerprint string) error {
	if fingerprint == "" {
		fingerprint = s.Fingerprint()
	}
	return os.WriteFile(s.Applied, fmt.Appendf(nil, "%s %d\n", fingerprint, time.Now().Unix()), 0o600)
}

// AppliedAt reads .env.applied: the fingerprint and when it was deployed. Empty and zero when there's none.
func (s *Settings) AppliedAt() (string, time.Time) {
	fields := strings.Fields(Read(s.Applied))
	if len(fields) == 0 {
		return "", time.Time{}
	}
	var at time.Time
	if len(fields) > 1 {
		if epoch, err := strconv.ParseInt(fields[1], 10, 64); err == nil {
			at = time.Unix(epoch, 0)
		}
	}
	return fields[0], at
}

// AppliedState is applied, pending, or untracked (deployed before .env.applied existed, or never).
type AppliedState string

const (
	Applied   AppliedState = "applied"
	Pending   AppliedState = "pending"
	Untracked AppliedState = "untracked"
)

// State compares .env with what the running stack was deployed with.
func (s *Settings) State() AppliedState {
	fingerprint, _ := s.AppliedAt()
	switch {
	case fingerprint == "":
		return Untracked
	case fingerprint == s.Fingerprint():
		return Applied
	default:
		return Pending
	}
}
