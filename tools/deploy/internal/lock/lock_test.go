package lock

import (
	"os"
	"strings"
	"testing"
)

func TestASecondActionIsRefusedUntilTheFirstEnds(t *testing.T) {
	root := t.TempDir()
	release, err := Acquire(root, "update")
	if err != nil {
		t.Fatal(err)
	}

	// The update's own child shares the lock.
	if _, err := Acquire(root, "apply"); err != nil {
		t.Errorf("the holder's child was refused: %v", err)
	}

	// Another process doesn't have the holder's environment.
	t.Setenv(envVar, "")
	os.Unsetenv(envVar)
	if _, err := Acquire(root, "backup"); err == nil || !strings.Contains(err.Error(), "update, started at") {
		t.Errorf("a second action got: %v, want a refusal naming the update", err)
	}

	release()
	again, err := Acquire(root, "backup")
	if err != nil {
		t.Fatalf("after the release: %v", err)
	}
	again()
}
