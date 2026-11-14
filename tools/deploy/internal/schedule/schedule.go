// Package schedule keeps the tool's cron jobs: a block of lines in the user's crontab, between two marker lines that
// name the checkout, so turning the schedule on twice changes nothing, turning it off removes exactly what it added,
// and two projects on one server keep separate blocks.
package schedule

import (
	"bytes"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"deploy/internal/ui"
)

// Job is one cron line: when, which command of the tool, and what it's for.
type Job struct {
	Spec, Command, What string
}

// Jobs are the tool's cron jobs. The media backup stops the image store while it copies, so it runs weekly, on
// Friday; the check runs off the hour, when fewer other jobs do.
var Jobs = []Job{
	{"0 3 * * *", "backup --db", "database backup, every night at 03:00"},
	{"0 4 * * 5", "backup --media", "media backup, Fridays at 04:00"},
	{"17 * * * *", "check", "health check, every hour"},
}

// LogFile is where the jobs' output goes: cron.log in the backups' folder.
func LogFile(backupDir string) string { return filepath.Join(backupDir, "cron.log") }

func begin(root string) string { return "# >>> deploy " + root + " (deploy/deploy.sh schedule)" }
func end(root string) string   { return "# <<< deploy " + root }

// Block is the checkout's block: the markers and one line per job, each appending its output to logFile.
func Block(root, logFile string) string {
	lines := []string{begin(root)}
	tool := word(filepath.Join(root, "deploy", "deploy.sh"))
	for _, job := range Jobs {
		lines = append(lines, job.Spec+" "+tool+" "+job.Command+" >>"+word(logFile)+" 2>&1")
	}
	return strings.Join(append(lines, end(root)), "\n")
}

var plainWord = regexp.MustCompile(`^[A-Za-z0-9/_.,:+-]+$`)

// word writes a path as one shell word of a cron line, where an unescaped `%` would end the command.
func word(path string) string {
	if plainWord.MatchString(path) {
		return path
	}
	quoted := "'" + strings.ReplaceAll(path, "'", `'\''`) + "'"
	return strings.ReplaceAll(quoted, "%", `\%`)
}

// split cuts a crontab into the lines outside the checkout's block and the lines inside it (markers left out).
func split(crontab, root string) (outside, inside []string) {
	in := false
	for _, line := range strings.Split(strings.TrimRight(crontab, "\n"), "\n") {
		switch {
		case line == begin(root):
			in = true
		case line == end(root):
			in = false
		case in:
			inside = append(inside, line)
		default:
			outside = append(outside, line)
		}
	}
	if len(outside) == 1 && outside[0] == "" {
		outside = nil
	}
	return outside, inside
}

// On reports whether the crontab holds the checkout's block.
func On(crontab, root string) bool { return len(Lines(crontab, root)) > 0 }

// Lines are the job lines of the checkout's block, as the crontab holds them.
func Lines(crontab, root string) []string {
	_, inside := split(crontab, root)
	return inside
}

// Current reports whether the block is the one this version of the tool writes: false after an update that changed
// the jobs, until the schedule is turned on again.
func Current(crontab, root, logFile string) bool {
	return strings.Join(Lines(crontab, root), "\n") ==
		strings.Join(strings.Split(Block(root, logFile), "\n")[1:len(Jobs)+1], "\n")
}

// HandWritten lists the lines outside the block that run this checkout's tool: the ones pasted from Set up's output
// before the tool kept a schedule itself. With the block on, they run every job twice.
func HandWritten(crontab, root string) []string {
	outside, _ := split(crontab, root)
	tool := filepath.Join(root, "deploy", "deploy.sh")
	var lines []string
	for _, line := range outside {
		if !strings.HasPrefix(strings.TrimSpace(line), "#") && strings.Contains(line, tool) {
			lines = append(lines, line)
		}
	}
	return lines
}

// With is the crontab with the checkout's block added, or replaced where it was.
func With(crontab, root, logFile string) string {
	outside, _ := split(crontab, root)
	return strings.Join(append(outside, Block(root, logFile)), "\n") + "\n"
}

// Without is the crontab with the checkout's block removed.
func Without(crontab, root string) string {
	outside, _ := split(crontab, root)
	if len(outside) == 0 {
		return ""
	}
	return strings.Join(outside, "\n") + "\n"
}

/*===== The User's Crontab =====*/

// Available reports whether cron's `crontab` command is installed.
func Available() bool {
	_, err := exec.LookPath("crontab")
	return err == nil
}

// Read returns the user's crontab, empty when there's none yet.
func Read() (string, error) {
	var stderr bytes.Buffer
	cmd := exec.Command("crontab", "-l")
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		// `crontab -l` fails for a user who has no crontab yet, which is only an empty one.
		if strings.Contains(stderr.String(), "no crontab") {
			return "", nil
		}
		return "", ui.Fail("Can't read the crontab: %s", strings.TrimSpace(stderr.String()))
	}
	return string(out), nil
}

// Write replaces the user's crontab.
func Write(crontab string) error {
	var stderr bytes.Buffer
	cmd := exec.Command("crontab", "-")
	cmd.Stdin, cmd.Stderr = strings.NewReader(crontab), &stderr
	if err := cmd.Run(); err != nil {
		return ui.Fail("Can't write the crontab: %s", strings.TrimSpace(stderr.String()))
	}
	return nil
}
