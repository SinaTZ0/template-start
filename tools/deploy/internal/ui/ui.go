// Package ui is the tool's output and prompts. On a terminal the prompts are huh's (arrow-key lists, answers edited in
// place); with NO_TUI=1 (or the old NO_GUM=1), or on a terminal that reports no size, they're plain line prompts.
// Without a terminal (cron, a pipe) nothing is ever asked: a prompt fails with an error naming the flag to pass, and a
// confirm takes its default.
package ui

import (
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"
)

var (
	// Interactive is set when stdin and stdout are both a terminal.
	Interactive bool
	// TUI is set when the prompts are huh's rather than plain lines.
	TUI   bool
	color bool

	// Out and Err are where the tool and the commands it runs print. While an action runs they also write to its log
	// file (runlog), so a command given them gets a pipe rather than the terminal, and prints as it would to a file.
	Out io.Writer = os.Stdout
	Err io.Writer = os.Stderr
)

func init() {
	Interactive = term.IsTerminal(int(os.Stdin.Fd())) && term.IsTerminal(int(os.Stdout.Fd()))
	// Colours only on a terminal, and never with NO_COLOR (https://no-color.org). Every status also says it in words.
	color = term.IsTerminal(int(os.Stdout.Fd())) && os.Getenv("NO_COLOR") == ""
	TUI = Interactive && os.Getenv("NO_TUI") == "" && os.Getenv("NO_GUM") == "" && hasSize()
}

// huh lays itself out by the terminal's size and draws nonsense on one that reports none.
func hasSize() bool {
	w, h, err := term.GetSize(int(os.Stdout.Fd()))
	return err == nil && w > 0 && h > 0
}

// Width is the terminal's width, 80 when it can't tell.
func Width() int {
	if w, _, err := term.GetSize(int(os.Stdout.Fd())); err == nil && w > 0 {
		return w
	}
	return 80
}

/*===== Colours =====*/

func paint(code, s string) string {
	if !color {
		return s
	}
	return "\x1b[" + code + "m" + s + "\x1b[0m"
}

func Red(s string) string    { return paint("31", s) }
func Green(s string) string  { return paint("32", s) }
func Yellow(s string) string { return paint("33", s) }
func Dim(s string) string    { return paint("2", s) }
func Bold(s string) string   { return paint("1", s) }

// Color reports whether output is coloured.
func Color() bool { return color }

/*===== Output =====*/

// Info prints a line to stdout.
func Info(format string, args ...any) { fmt.Fprintln(Out, sprintf(format, args...)) }

// Step starts a phase of an action: a blank line, then `==> text` in bold.
func Step(format string, args ...any) {
	fmt.Fprintf(Out, "\n%s\n", Bold("==> "+sprintf(format, args...)))
}

// OK reports something that worked.
func OK(format string, args ...any) {
	fmt.Fprintf(Out, "%s %s\n", Green("✓"), sprintf(format, args...))
}

// Private prints a line to the terminal only, never to a log file: a password that's shown once.
func Private(format string, args ...any) { fmt.Fprintln(os.Stdout, sprintf(format, args...)) }

// Warn reports something that needs attention, on stderr.
func Warn(format string, args ...any) {
	fmt.Fprintf(Err, "%s %s\n", Yellow("!"), sprintf(format, args...))
}

// Clear clears the terminal, for the menu.
func Clear() { fmt.Fprint(Out, "\x1b[H\x1b[2J") }

// sprintf is fmt.Sprintf that leaves a format without arguments alone, so a message holding a `%` prints as it is.
func sprintf(format string, args ...any) string {
	if len(args) == 0 {
		return format
	}
	return fmt.Sprintf(format, args...)
}

/*===== Failures =====*/

// Failure is an action that stopped with a message for the operator: main prints it as `✗ message` and exits with
// Code (1 when it's 0), and the menu prints it and comes back. It's what `die` was in deploy.sh. An empty message
// prints nothing, for a failure whose command already said why.
type Failure struct {
	Message string
	Code    int
}

func (f *Failure) Error() string { return f.Message }

// Fail returns a Failure.
func Fail(format string, args ...any) error { return &Failure{Message: sprintf(format, args...)} }

// UsageError is a command line the tool doesn't understand: exit code 2.
type UsageError struct{ Message string }

func (u *UsageError) Error() string { return u.Message }

// Usage returns a UsageError.
func Usage(format string, args ...any) error { return &UsageError{Message: sprintf(format, args...)} }

// PrintError prints an action's error the way `die` did.
func PrintError(err error) {
	msg := err.Error()
	if msg == "" {
		return
	}
	fmt.Fprintln(Err, Red("✗ "+msg))
}

// Indent prefixes every line of text with prefix.
func Indent(text, prefix string) string {
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	for i, line := range lines {
		lines[i] = prefix + line
	}
	return strings.Join(lines, "\n")
}
