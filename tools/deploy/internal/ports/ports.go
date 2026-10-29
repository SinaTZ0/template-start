// Package ports says what listens on 80 and 443, which Caddy needs. Another web server on them (one that came with
// the VPS image) is the most common reason a first deploy fails.
package ports

import (
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"deploy/internal/ui"
)

var processName = regexp.MustCompile(`users:\(\("([^"]*)"`)

// Owner says what listens on a TCP port: empty when it's free, a process name, or `unknown` when `ss` can't tell
// (another user's process, without root). `ss` rather than /proc: only it names the process without root.
func Owner(port int) string {
	if _, err := exec.LookPath("ss"); err != nil {
		return "unknown"
	}
	out, err := exec.Command("ss", "-Hltnp", "sport = :"+strconv.Itoa(port)).Output()
	if err != nil {
		return ""
	}
	line, _, _ := strings.Cut(strings.TrimSpace(string(out)), "\n")
	if line == "" {
		return ""
	}
	if m := processName.FindStringSubmatch(line); m != nil && m[1] != "" {
		return m[1]
	}
	return "unknown"
}

// CheckFree fails when something other than Docker holds 80 or 443, and warns when it can't tell what does.
func CheckFree() error {
	for _, port := range []int{80, 443} {
		switch owner := Owner(port); owner {
		case "", "docker-proxy":
		case "unknown":
			ui.Warn("Port %d is in use, and it's not clear by what. Caddy needs it.", port)
		default:
			return ui.Fail("Port %d is in use by %s. Caddy needs it: stop that first (e.g. sudo systemctl disable --now %s).",
				port, owner, owner)
		}
	}
	return nil
}
