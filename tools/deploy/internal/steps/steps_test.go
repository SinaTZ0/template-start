package steps

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestParse(t *testing.T) {
	got, err := Parse("---\nrun:\n  - seed notes --replace\n  - seed notes --owner a@example.com\n---\n" +
		"Why.\n\n- a list in the body isn't a command\n")
	if err != nil {
		t.Fatal(err)
	}
	want := [][]string{{"seed", "notes", "--replace"}, {"seed", "notes", "--owner", "a@example.com"}}
	if !slices.EqualFunc(got, want, slices.Equal) {
		t.Errorf("Parse = %v", got)
	}

	for name, text := range map[string]string{
		"no front matter": "run:\n  - seed notes\n",
		"not closed":      "---\nrun:\n  - seed notes\n",
		"no commands":     "---\nrun:\n---\n",
		"other keys":      "---\nrun:\n  - seed notes\nshell: rm -rf /\n---\n",
	} {
		if _, err := Parse(text); err == nil {
			t.Errorf("%s: Parse accepted %q", name, text)
		}
	}
}

func TestLoadAndPending(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, Dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	step := "---\nrun:\n  - seed notes\n---\n"
	for file, text := range map[string]string{
		"20261102-0900-later.md": step,
		"20261101-0900-early.md": step,
		"20261103-0900-Bad.md":   step,
		"README.md":              "not a step",
		"needs-step.txt":         "src/db/seed-notes.ts",
	} {
		if err := os.WriteFile(filepath.Join(dir, file), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	all, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, s := range all {
		names = append(names, s.Name)
	}
	if want := []string{"20261101-0900-early", "20261102-0900-later", "20261103-0900-Bad"}; !slices.Equal(names, want) {
		t.Fatalf("Load = %v", names)
	}
	if all[2].Err == nil {
		t.Error("a name with capitals should be an error")
	}

	// The later step ran and the earlier one didn't: membership, not order, decides, so the earlier one is pending.
	// A started step that didn't finish is pending too.
	ledger := Ledger{Rows: map[string]Row{
		BaselineName:          {Finished: true, Skipped: true},
		"20261102-0900-later": {Commands: 1, Done: 1, Finished: true},
		"20261103-0900-Bad":   {Commands: 1, Done: 0},
	}}
	var pending []string
	for _, s := range Pending(all, ledger) {
		pending = append(pending, s.Name)
	}
	if want := []string{"20261101-0900-early", "20261103-0900-Bad"}; !slices.Equal(pending, want) {
		t.Errorf("Pending = %v", pending)
	}
}
