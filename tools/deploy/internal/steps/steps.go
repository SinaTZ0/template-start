// Package steps reads the deploy steps in deploy/steps/ and the server's ledger of the ones it ran
// (docs/deployment.md → Deploy Steps). A step is a commit's commands for the server: the tool's own subcommands,
// never a shell. Which ones may run, and how, is the commands package's business; this one only knows files and rows.
package steps

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// Dir is where the step files live, relative to the checkout.
const Dir = "deploy/steps"

// namePattern is a step's name: when it was written, then what it's about (`20261029-1930-ee-faculty`). The date
// keeps them in the order they were written; the ledger doesn't depend on it.
var namePattern = regexp.MustCompile(`^\d{8}-\d{4}-[a-z0-9]+(-[a-z0-9]+)*$`)

// Step is one step file.
type Step struct {
	Name     string
	Commands [][]string
	// Err is why the file can't be read as a step. A broken step that already ran is only listed, so Load keeps it.
	Err error
}

// Load reads every step file in root's deploy/steps/, by name. Other files there (README.md, needs-step.txt) are
// skipped: only names starting with a digit are steps. A missing folder is no steps.
func Load(root string) ([]Step, error) {
	entries, err := os.ReadDir(filepath.Join(root, Dir))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []Step
	for _, entry := range entries {
		file := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(file, ".md") || file[0] < '0' || file[0] > '9' {
			continue
		}
		step := Step{Name: strings.TrimSuffix(file, ".md")}
		if !namePattern.MatchString(step.Name) {
			step.Err = fmt.Errorf("the name isn't <yyyymmdd>-<hhmm>-<words-with-dashes>.md")
		} else if data, err := os.ReadFile(filepath.Join(root, Dir, file)); err != nil {
			step.Err = err
		} else {
			step.Commands, step.Err = Parse(string(data))
		}
		out = append(out, step)
	}
	slices.SortFunc(out, func(a, b Step) int { return strings.Compare(a.Name, b.Name) })
	return out, nil
}

// Parse reads a step file's commands: the `run:` list in its front matter. The front matter is only that list, so a
// few lines of parsing do instead of a YAML library:
//
//	---
//	run:
//	  - seed notes --replace
//	---
//	Why, and what it overwrites.
func Parse(text string) ([][]string, error) {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return nil, errors.New("it doesn't start with a --- line")
	}
	var commands [][]string
	inRun, closed := false, false
	for _, line := range lines[1:] {
		trimmed := strings.TrimSpace(line)
		switch {
		case trimmed == "---":
			closed = true
		case trimmed == "" || strings.HasPrefix(trimmed, "#"):
			continue
		case trimmed == "run:":
			inRun = true
			continue
		case inRun && strings.HasPrefix(trimmed, "- "):
			fields := strings.Fields(strings.TrimPrefix(trimmed, "- "))
			if len(fields) == 0 {
				return nil, errors.New("an empty command in run")
			}
			commands = append(commands, fields)
			continue
		default:
			return nil, fmt.Errorf("unexpected line in the front matter: %q (only a run: list goes there)", trimmed)
		}
		if closed {
			break
		}
	}
	if !closed {
		return nil, errors.New("the front matter has no closing --- line")
	}
	if len(commands) == 0 {
		return nil, errors.New("run: lists no commands")
	}
	return commands, nil
}

// Pending are the steps the ledger has no finished row for, in name order. Membership, not "everything after the last
// one that ran": a step whose name sorts before one that ran still runs.
func Pending(all []Step, ledger Ledger) []Step {
	var out []Step
	for _, step := range all {
		if row, ok := ledger.Rows[step.Name]; !ok || !row.Finished {
			out = append(out, step)
		}
	}
	return out
}

// Commandline is a command as the step file wrote it.
func Commandline(command []string) string { return strings.Join(command, " ") }
