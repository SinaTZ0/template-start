package sources

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
)

/*===== Docker Hub =====*/

// DockerDaemonConfigPath is Docker's daemon configuration file on Linux.
const DockerDaemonConfigPath = "/etc/docker/daemon.json"

// DockerMirrors are the Russian Docker Hub registry mirrors offered when registry-1.docker.io is blocked.
var DockerMirrors = []string{
	"https://dockerhub.timeweb.cloud",
	"https://huecker.io",
}

// HasDockerMirrors reports whether daemon.json already lists at least one registry mirror.
func HasDockerMirrors(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	var cfg struct {
		Mirrors []string `json:"registry-mirrors"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return false
	}
	return len(cfg.Mirrors) > 0
}

// ProbeDockerHub checks whether this server can reach registry-1.docker.io.
// A reachable Docker Hub answers 401 Unauthorized (Bearer auth challenge) or 200; a geo-blocked server answers
// 403 Forbidden or times out.
func ProbeDockerHub(ctx context.Context) string {
	status, err := get(ctx, "https://registry-1.docker.io/v2/", "")
	switch {
	case err != nil:
		return "it doesn't answer from this server"
	case status == http.StatusForbidden:
		return "it answers 403 Forbidden (Docker Hub blocks some regions)"
	case status >= 500:
		return fmt.Sprintf("it answers HTTP %d", status)
	}
	return ""
}

// WriteDockerMirrors writes mirrors into daemon.json under "registry-mirrors", preserving any existing settings.
func WriteDockerMirrors(path string, mirrors []string) error {
	cfg := map[string]any{}
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read %s: %w", path, err)
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &cfg); err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}
	}

	cfg["registry-mirrors"] = mirrors
	out, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	out = append(out, '\n')

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create %s: %w", filepath.Dir(path), err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("replace %s: %w", path, err)
	}
	return nil
}
