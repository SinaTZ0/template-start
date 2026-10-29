package ui

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/key"
	"charm.land/huh/v2"
	"golang.org/x/term"

	"deploy/internal/interrupt"
)

/*===== Prompts =====*/

// Ask asks for a line of text. With huh the default is filled in, ready to edit; plain, Enter takes it. Without a
// terminal it fails, naming flag (when given) as what to pass instead.
func Ask(question, def, flag string) (string, error) {
	if !Interactive {
		if flag != "" {
			return "", Fail("No terminal to ask %q: pass %s.", question, flag)
		}
		return "", Fail("No terminal to ask %q.", question)
	}
	var answer string
	if TUI {
		answer = def
		if err := run(huh.NewInput().Title(question).Value(&answer).CharLimit(0)); err != nil {
			return "", err
		}
		showAnswer(question, or(answer, "(none)"))
	} else {
		prompt := question + ": "
		if def != "" {
			prompt = fmt.Sprintf("%s [%s]: ", question, def)
		}
		line, err := readLine(prompt)
		if err != nil {
			return "", err
		}
		answer = line
	}
	return or(strings.TrimSpace(answer), def), nil
}

// AskSecret is Ask without showing the answer while it's typed, and without a default.
func AskSecret(question string) (string, error) {
	if !Interactive {
		return "", Fail("No terminal to ask %q.", question)
	}
	if TUI {
		var answer string
		if err := run(huh.NewInput().Title(question).Value(&answer).EchoMode(huh.EchoModePassword).CharLimit(0)); err != nil {
			return "", err
		}
		shown := "(none)"
		if answer != "" {
			shown = "(hidden)"
		}
		showAnswer(question, shown)
		return strings.TrimSpace(answer), nil
	}
	return readPassword(question + ": ")
}

// Confirm asks a yes/no question. def is what Enter answers, and what's used without a terminal.
func Confirm(question string, def bool) (bool, error) {
	if !Interactive {
		return def, nil
	}
	if TUI {
		answer := def
		if err := run(huh.NewConfirm().Title(question).Affirmative("Yes").Negative("No").Value(&answer)); err != nil {
			return false, err
		}
		showAnswer(question, map[bool]string{true: "yes", false: "no"}[answer])
		return answer, nil
	}
	hint := "[y/N]"
	if def {
		hint = "[Y/n]"
	}
	line, err := readLine(question + " " + hint + " ")
	if err != nil {
		return false, err
	}
	line = strings.TrimSpace(line)
	if line == "" {
		return def, nil
	}
	return line[0] == 'y' || line[0] == 'Y', nil
}

// Choose asks for one of the options and returns its index, from 0.
func Choose(question string, options []string) (int, error) {
	if !Interactive {
		return 0, Fail("No terminal to ask %q.", question)
	}
	if TUI {
		choice := 0
		opts := make([]huh.Option[int], len(options))
		for i, option := range options {
			opts[i] = huh.NewOption(option, i)
		}
		height := min(len(options), 15) + 1
		if err := run(huh.NewSelect[int]().Title(question).Options(opts...).Value(&choice).Height(height)); err != nil {
			return 0, err
		}
		showAnswer(question, options[choice])
		return choice, nil
	}
	fmt.Fprintln(Err, question)
	for i, option := range options {
		fmt.Fprintf(Err, "  %d) %s\n", i+1, option)
	}
	for {
		line, err := readLine("> ")
		if err != nil {
			return 0, err
		}
		n, convErr := strconv.Atoi(strings.TrimSpace(line))
		if convErr == nil && n >= 1 && n <= len(options) {
			return n - 1, nil
		}
		Warn("Pick a number from 1 to %d.", len(options))
	}
}

// Pause waits for Enter (or Ctrl-C), for the menu to come back after an action.
func Pause() {
	fmt.Fprint(Err, "\nPress Enter for the menu… ")
	// A plain prompt that Ctrl-C left waiting for its line already reads the terminal: take that line instead.
	if pending != nil {
		_, _ = readLine("")
		return
	}
	fd := int(os.Stdin.Fd())
	state, err := term.MakeRaw(fd)
	if err != nil {
		_, _ = readLine("")
		return
	}
	defer func() {
		_ = term.Restore(fd, state)
		fmt.Fprintln(Err)
	}()
	// Raw, so Ctrl-C arrives as a key (3) rather than a signal, and ends the wait like Enter.
	buf := make([]byte, 1)
	for {
		if n, err := os.Stdin.Read(buf); err != nil || (n == 1 && (buf[0] == '\r' || buf[0] == '\n' || buf[0] == 3)) {
			return
		}
	}
}

/*===== huh =====*/

// ReadLine is a plain line prompt, for the menu without huh.
func ReadLine(prompt string) (string, error) { return readLine(prompt) }

// run shows one field as its own form. Esc gives up on it, like Ctrl-C.
func run(field huh.Field) error {
	err := huh.NewForm(huh.NewGroup(field)).WithKeyMap(keyMap()).WithShowHelp(false).RunWithContext(interrupt.Context())
	if errors.Is(err, huh.ErrUserAborted) || interrupt.Happened() {
		return interrupt.ErrInterrupted
	}
	return err
}

// keyMap is huh's keys, with Esc giving up like Ctrl-C.
func keyMap() *huh.KeyMap {
	keys := huh.NewDefaultKeyMap()
	keys.Quit = key.NewBinding(key.WithKeys("ctrl+c", "esc"))
	return keys
}

// huh clears a prompt once it's answered; this leaves the question and its answer in the scrollback.
func showAnswer(question, answer string) {
	fmt.Fprintf(Err, "%s  %s\n", Dim(question), answer)
}

func or(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

/*===== Plain Lines =====*/

type lineResult struct {
	line string
	err  error
}

var (
	stdin = bufio.NewReader(os.Stdin)
	// pending is the read still waiting for a line after Ctrl-C gave up on its prompt. A read on a terminal can't be
	// cancelled, so the next prompt takes that line rather than start a second read.
	pending chan lineResult
)

// readLine prints prompt to stderr and reads a line. Ctrl-C returns ErrInterrupted; so does Ctrl-D.
func readLine(prompt string) (string, error) {
	fmt.Fprint(Err, prompt)
	if pending == nil {
		pending = make(chan lineResult, 1)
		go func(ch chan lineResult) {
			line, err := stdin.ReadString('\n')
			ch <- lineResult{line, err}
		}(pending)
	}
	select {
	case r := <-pending:
		pending = nil
		if r.err != nil && (r.line == "" || !errors.Is(r.err, io.EOF)) {
			fmt.Fprintln(Err)
			return "", interrupt.ErrInterrupted
		}
		return strings.TrimRight(r.line, "\r\n"), nil
	case <-interrupt.Context().Done():
		fmt.Fprintln(Err)
		return "", interrupt.ErrInterrupted
	}
}

// readPassword reads a line without echoing it. Ctrl-C puts the terminal back as it was.
func readPassword(prompt string) (string, error) {
	fmt.Fprint(Err, prompt)
	fd := int(os.Stdin.Fd())
	state, err := term.GetState(fd)
	if err != nil {
		return "", err
	}
	done := make(chan lineResult, 1)
	go func() {
		b, err := term.ReadPassword(fd)
		done <- lineResult{string(b), err}
	}()
	select {
	case r := <-done:
		fmt.Fprintln(Err)
		if r.err != nil {
			return "", interrupt.ErrInterrupted
		}
		return strings.TrimSpace(r.line), nil
	case <-interrupt.Context().Done():
		_ = term.Restore(fd, state)
		fmt.Fprintln(Err)
		return "", interrupt.ErrInterrupted
	}
}
