// Package envfile reads, tidies, checks and edits .env. It's only ever read line by line, never sourced: it's data,
// not a script, and Compose reads it the same way.
package envfile

import (
	"os"
	"regexp"
	"slices"
	"strings"
)

var (
	assignment = regexp.MustCompile(`^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=`)
	keyLine    = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_]*)=(.*)$`)
	inlineNote = regexp.MustCompile(`[ \t]+#.*$`)
	noteAfter  = regexp.MustCompile(`^([ \t]+#.*)?$`)
	blankLine  = regexp.MustCompile(`^[[:space:]]*(#.*)?$`)
)

// lines splits a file's content into lines, without the empty one after a final newline.
func lines(content string) []string {
	if content == "" {
		return nil
	}
	return strings.Split(strings.TrimSuffix(content, "\n"), "\n")
}

// Normalize turns .env into what Compose reads, line for line: LF line endings, no trailing whitespace, no `export `,
// no spaces around `=`, a final newline. Quotes are dropped when nothing inside needs them, and so is an inline
// ` # comment` after an unquoted value (Compose drops it too). Comments and order stay. With dedupe, a key set twice
// keeps only its last line, as Compose and Get do; without it every line stays, for counting them.
func Normalize(content string, dedupe bool) string {
	type entry struct{ text, key string }
	var out []entry
	last := map[string]int{}
	for _, line := range lines(content) {
		line = strings.TrimRight(strings.TrimSuffix(line, "\r"), " \t")
		loc := assignment.FindStringSubmatchIndex(line)
		if loc == nil {
			out = append(out, entry{text: line})
			continue
		}
		key := line[loc[2]:loc[3]]
		value := strings.TrimLeft(line[loc[1]:], " \t")
		if value != "" && (value[0] == '"' || value[0] == '\'') {
			quote := value[0]
			rest := value[1:]
			if end := strings.IndexByte(rest, quote); end >= 0 {
				inner, after := rest[:end], rest[end+1:]
				if noteAfter.MatchString(after) && !strings.ContainsAny(inner, " \t\"$\\`#'") {
					value = inner
				}
			}
		} else {
			value = inlineNote.ReplaceAllString(value, "")
		}
		last[key] = len(out)
		out = append(out, entry{text: key + "=" + value, key: key})
	}
	var b strings.Builder
	for i, e := range out {
		if dedupe && e.key != "" && last[e.key] != i {
			continue
		}
		b.WriteString(e.text)
		b.WriteByte('\n')
	}
	return b.String()
}

// Parse reads settings as Compose would see them.
func Parse(content string) map[string]string {
	values := map[string]string{}
	for _, line := range lines(Normalize(content, true)) {
		if m := keyLine.FindStringSubmatch(line); m != nil {
			values[m[1]] = m[2]
		}
	}
	return values
}

// Duplicates lists the keys set more than once, sorted.
func Duplicates(content string) []string {
	count := map[string]int{}
	for _, line := range lines(Normalize(content, false)) {
		if m := keyLine.FindStringSubmatch(line); m != nil {
			count[m[1]]++
		}
	}
	var dups []string
	for key, n := range count {
		if n > 1 {
			dups = append(dups, key)
		}
	}
	slices.Sort(dups)
	return dups
}

// Unparseable lists the 1-based numbers of lines that are neither blank, a comment, nor KEY=value once tidied:
// Compose refuses the whole file over one of them.
func Unparseable(content string) []int {
	var bad []int
	for i, line := range lines(Normalize(content, false)) {
		if !blankLine.MatchString(line) && !keyLine.MatchString(line) {
			bad = append(bad, i+1)
		}
	}
	return bad
}

// Read returns a file's content, empty when it doesn't exist.
func Read(path string) string {
	b, _ := os.ReadFile(path)
	return string(b)
}

// Get reads one variable straight from the file, the last line winning, as in Compose. Empty when it's not set.
func Get(path, key string) string {
	value := ""
	for _, line := range lines(Read(path)) {
		if rest, ok := strings.CutPrefix(line, key+"="); ok {
			value = strings.TrimSuffix(rest, "\r")
		}
	}
	return value
}

// Set replaces the variable's lines, or appends one. The file is written in place, so it keeps its permissions and a
// symlinked .env stays a symlink.
func Set(path, key, value string) error {
	content := Read(path)
	all := lines(content)
	found := false
	for i, line := range all {
		if strings.HasPrefix(line, key+"=") {
			all[i] = key + "=" + value
			found = true
		}
	}
	if !found {
		all = append(all, key+"="+value)
	}
	return os.WriteFile(path, []byte(strings.Join(all, "\n")+"\n"), 0o600)
}

// Example is .env.production.example: its keys in their order, and its values (the defaults).
type Example struct {
	Keys   []string
	Values map[string]string
}

// ReadExample reads the example; a missing one is empty.
func ReadExample(path string) Example {
	ex := Example{Values: map[string]string{}}
	for _, line := range lines(Read(path)) {
		m := keyLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		if _, seen := ex.Values[m[1]]; !seen {
			ex.Keys = append(ex.Keys, m[1])
		}
		ex.Values[m[1]] = m[2]
	}
	return ex
}

// NewKeys returns the lines to append to .env for the example's keys it doesn't have, each run of them under the
// comment block above it in the example, and the keys themselves.
func NewKeys(envContent, exampleContent string) (string, []string) {
	present := map[string]bool{}
	for _, line := range lines(envContent) {
		if m := keyLine.FindStringSubmatch(line); m != nil {
			present[m[1]] = true
		}
	}
	// `block` is the comment above the current run of keys; `prev` is set while the previous key was appended too, so
	// a run of new keys stays together under one comment, as in the example.
	var b strings.Builder
	var added []string
	block, inKeys, prev := "", false, false
	for _, line := range lines(exampleContent) {
		switch m := keyLine.FindStringSubmatch(line); {
		case strings.HasPrefix(line, "#"):
			if inKeys {
				block, inKeys = "", false
			}
			block += line + "\n"
		case m != nil:
			if !present[m[1]] {
				if !prev {
					b.WriteString("\n" + block)
				} else if !inKeys {
					b.WriteString(block)
				}
				b.WriteString(line + "\n")
				added = append(added, m[1])
				prev = true
			} else {
				prev = false
			}
			inKeys = true
		default:
			block, inKeys, prev = "", false, false
		}
	}
	return b.String(), added
}
