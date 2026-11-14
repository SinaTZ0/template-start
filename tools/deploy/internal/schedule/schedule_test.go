package schedule

import (
	"strings"
	"testing"
)

// The crontab belongs to the user: the tool may only ever touch its own block.
func TestTheBlockLeavesTheRestOfTheCrontabAlone(t *testing.T) {
	const root, log = "/srv/app", "/srv/app/backups/cron.log"
	own := "MAILTO=me@example.com\n15 2 * * * /usr/local/bin/other-job\n" +
		"0 3 * * * /srv/app/deploy/deploy.sh backup --db >>/srv/app/backups/cron.log 2>&1\n"

	on := With(own, root, log)
	if !strings.HasPrefix(on, own) || !On(on, root) || !Current(on, root, log) {
		t.Fatalf("turned on:\n%s", on)
	}
	if again := With(on, root, log); again != on {
		t.Errorf("turning it on twice changed the crontab:\n%s", again)
	}
	if On(on, "/srv/other") {
		t.Error("another checkout sees this one's block")
	}
	// The line pasted by hand before the tool kept a schedule would now back up twice a night.
	if lines := HandWritten(on, root); len(lines) != 1 || !strings.Contains(lines[0], "backup --db") {
		t.Errorf("hand-written lines = %q", lines)
	}
	if off := Without(on, root); off != own {
		t.Errorf("turned off:\n%s\nwant:\n%s", off, own)
	}
	if off := Without(With("", root, log), root); off != "" {
		t.Errorf("an empty crontab came back as %q", off)
	}
}

// Cron ends a command at a bare `%`, and the shell splits a path at a space.
func TestBlockQuotesAwkwardPaths(t *testing.T) {
	block := Block("/srv/my app", "/srv/100%/cron.log")
	if !strings.Contains(block, "'/srv/my app/deploy/deploy.sh' check >>'/srv/100\\%/cron.log' 2>&1") {
		t.Errorf("block:\n%s", block)
	}
}
