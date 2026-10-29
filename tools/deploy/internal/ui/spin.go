package ui

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"time"

	"deploy/internal/interrupt"
)

// Spin runs fn with a spinner. fn gets the writer for its commands' stderr: with the spinner, their messages are held
// back until it ends, so they don't tear through it; without one (plain prompts, no terminal) they go straight out,
// after a dim `title…` line. stdout is never touched, so a command can stream a dump into a file through it. The
// frames go to the terminal alone; a log file gets the held messages.
func Spin(title string, fn func(stderr io.Writer) error) error {
	if !TUI {
		fmt.Fprintln(Err, Dim(title+"…"))
		return interrupt.Check(fn(Err))
	}
	var held bytes.Buffer
	done := make(chan error, 1)
	go func() { done <- fn(&held) }()

	frames := []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	fmt.Fprint(os.Stderr, "\x1b[?25l")
	var err error
	for i := 0; ; i++ {
		fmt.Fprintf(os.Stderr, "\r\x1b[K%s %s", paint("35", frames[i%len(frames)]), title)
		select {
		case err = <-done:
		case <-ticker.C:
			continue
		}
		break
	}
	fmt.Fprint(os.Stderr, "\r\x1b[K\x1b[?25h")
	_, _ = Err.Write(held.Bytes())
	return interrupt.Check(err)
}
