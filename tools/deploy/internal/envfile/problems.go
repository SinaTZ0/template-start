package envfile

import (
	"fmt"
	"slices"
	"strings"

	"deploy/internal/settings"
	"deploy/internal/ui"
)

// Settings is .env with its example and applied-state files: everything the check, the editor and the Settings status
// line need. PgdataExists reports whether the database volume exists (stack.PgdataExists).
type Settings struct {
	Env, Example, Applied string
	// Dir holds the editor's working copy, next to .env.
	Dir          string
	PgdataExists func() bool

	// dsnRaised is the DSN a mismatch was last raised for, so each one is raised once per run, not on every pass.
	dsnRaised string
}

// Problems lists every problem in the file at path: the example's keys in its order, then the keys the example doesn't
// have, then lines Compose can't parse.
func (s *Settings) Problems(path string) []settings.Problem {
	content := Read(path)
	ex := ReadExample(s.Example)
	values := Parse(content)
	check := settings.Checker{Values: values, Example: ex.Values, PgdataExists: s.PgdataExists}

	var problems []settings.Problem
	for _, key := range ex.Keys {
		if value, ok := values[key]; ok {
			problems = append(problems, check.Validate(key, value, true)...)
			continue
		}
		// Not in .env yet (added to the example since): Check appends it with the example's value.
		fix := settings.Gen
		for _, p := range check.Validate(key, ex.Values[key], true) {
			if p.Fix != settings.Warn {
				fix = p.Fix
				break
			}
		}
		problems = append(problems, settings.Problem{Key: key, Fix: fix, State: settings.Missing,
			Reason: "not in .env yet (new in .env.production.example)"})
	}

	var extra []string
	for key := range values {
		if _, inExample := ex.Values[key]; !inExample {
			extra = append(extra, key)
		}
	}
	slices.Sort(extra)
	for _, key := range extra {
		problems = append(problems, check.Validate(key, values[key], false)...)
	}

	for _, n := range Unparseable(content) {
		problems = append(problems, settings.Problem{Key: fmt.Sprintf("line %d", n), Fix: settings.Ask,
			State: settings.Invalid, Reason: "isn't KEY=value, so Compose can't read .env"})
	}
	return problems
}

// only keeps the problems with this fix.
func only(problems []settings.Problem, fix settings.Fix) []settings.Problem {
	var out []settings.Problem
	for _, p := range problems {
		if p.Fix == fix {
			out = append(out, p)
		}
	}
	return out
}

// PrintProblems prints problems as an indented list, on stderr.
func PrintProblems(problems []settings.Problem) {
	for _, p := range problems {
		fmt.Fprintf(ui.Err, "    %-30s %s\n", p.Key, p.Reason)
	}
}

// JoinComma joins items as `a, b, c`, without duplicates.
func JoinComma(items []string) string {
	var seen []string
	for _, item := range items {
		if !slices.Contains(seen, item) {
			seen = append(seen, item)
		}
	}
	return strings.Join(seen, ", ")
}

// keysOf lists the problems' keys, without duplicates, in order.
func keysOf(problems []settings.Problem) []string {
	var keys []string
	for _, p := range problems {
		if !slices.Contains(keys, p.Key) {
			keys = append(keys, p.Key)
		}
	}
	return keys
}
