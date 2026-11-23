package sources

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestWriteAndReadDockerMirrors(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "daemon.json")

	if HasDockerMirrors(path) {
		t.Fatal("expected HasDockerMirrors to be false when file does not exist")
	}

	// Preserve unrelated daemon settings when adding mirrors.
	initial := `{"log-driver":"json-file","live-restore":true}`
	if err := os.WriteFile(path, []byte(initial), 0o644); err != nil {
		t.Fatal(err)
	}
	if HasDockerMirrors(path) {
		t.Fatal("expected HasDockerMirrors to be false before mirrors are configured")
	}

	if err := WriteDockerMirrors(path, DockerMirrors); err != nil {
		t.Fatalf("WriteDockerMirrors failed: %v", err)
	}
	if !HasDockerMirrors(path) {
		t.Fatal("expected HasDockerMirrors to be true after writing mirrors")
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["log-driver"] != "json-file" || parsed["live-restore"] != true {
		t.Fatalf("existing settings were not preserved: %#v", parsed)
	}

	gotMirrors := make([]string, 0, len(DockerMirrors))
	for _, entry := range parsed["registry-mirrors"].([]any) {
		gotMirrors = append(gotMirrors, entry.(string))
	}
	if !reflect.DeepEqual(gotMirrors, DockerMirrors) {
		t.Fatalf("mirrors mismatch: got %v, want %v", gotMirrors, DockerMirrors)
	}
}
