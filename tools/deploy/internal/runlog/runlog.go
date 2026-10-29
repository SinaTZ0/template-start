// Package runlog keeps a file per action in deploy/logs/: everything the action printed, its commands' output
// included, as plain text with each line's time. A terminal's scrollback ends with its window and tmux keeps only so
// many lines, while a build that fails at its end can need its start to explain it.
package runlog

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"deploy/internal/interrupt"
	"deploy/internal/ui"
)

// Keep is how many log files stay; older ones are removed when a new one starts. A nightly backup from cron adds one
// a day, so this is about three months of them.
const Keep = 100

// envVar names the open log to a deploy tool run as a child (Update's `apply --after-update`), which appends to it
// rather than start its own: one action, one file.
const envVar = "DEPLOY_LOG"

// Log is the file an action's output goes to, besides the terminal. A nil Log (none could be opened) does nothing.
type Log struct {
	// Rel is the file relative to the checkout, as the operator would open it from there.
	Rel string

	file     *os.File
	owner    bool
	start    time.Time
	out, err io.Writer
}

// Dir is the folder the logs are in.
func Dir(root string) string { return filepath.Join(root, "deploy", "logs") }

// Open starts the log of an action: from now until Close, ui.Out and ui.Err write to the file too. A logging failure
// is a warning, never the action's failure: a deploy shouldn't stop because its log couldn't be written.
func Open(root, name string, args []string) *Log {
	l := &Log{start: time.Now(), out: ui.Out, err: ui.Err}
	var err error
	if parent := os.Getenv(envVar); parent != "" {
		l.file, err = os.OpenFile(parent, os.O_WRONLY|os.O_APPEND, 0)
	} else {
		l.owner = true
		l.file, err = create(root, name)
	}
	if err != nil {
		ui.Warn("This run keeps no log file: %v", err)
		return nil
	}
	l.Rel, _ = filepath.Rel(root, l.file.Name())
	if l.owner {
		_ = os.Setenv(envVar, l.file.Name())
	}

	s := &sink{file: l.file, lineStart: true}
	ui.Out = io.MultiWriter(l.out, &stream{sink: s})
	ui.Err = io.MultiWriter(l.err, &stream{sink: s})
	s.header(strings.Join(append([]string{"deploy/deploy.sh", name}, args...), " "), l.start)
	return l
}

// create makes a new log file, named by its start time so the names sort by age, and removes the oldest beyond Keep.
// The folder and files are the operator's alone, like .env: a log holds the server's paths and settings.
func create(root, name string) (*os.File, error) {
	dir := Dir(root)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, time.Now().Format("20060102-150405")+"-"+name+".log")
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return nil, err
	}
	if old, _ := filepath.Glob(filepath.Join(dir, "*.log")); len(old) > Keep {
		slices.Sort(old)
		for _, p := range old[:len(old)-Keep] {
			_ = os.Remove(p)
		}
	}
	return f, nil
}

// Close ends the log with the action's outcome and stops copying output to it. After a failure it names the file on
// the terminal, under the error, which the caller has printed by then. A child's log leaves both to its parent.
func (l *Log) Close(err error) {
	if l == nil {
		return
	}
	ui.Out, ui.Err = l.out, l.err
	if l.owner {
		_ = os.Unsetenv(envVar)
		took := time.Since(l.start).Round(time.Second)
		// A failure's message is in the log already, printed above.
		outcome := "done"
		switch {
		case err == interrupt.ErrInterrupted:
			outcome = "stopped with Ctrl-C"
		case err != nil:
			outcome = "failed"
		}
		fmt.Fprintf(l.file, "%s == %s, after %s\n", time.Now().Format("15:04:05"), outcome, took)
	}
	_ = l.file.Close()
	if l.owner && err != nil && err != interrupt.ErrInterrupted {
		ui.Info("  %s", ui.Dim("The whole output: "+l.Rel))
	}
}

/*===== Plain Text =====*/

// sink is the file both streams write to, and whether the next byte starts a line.
type sink struct {
	mu        sync.Mutex
	file      *os.File
	lineStart bool
}

func (s *sink) header(command string, start time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fmt.Fprintf(s.file, "%s == %s, on %s\n", start.Format("15:04:05"), command, start.Format("2006-01-02"))
}

// stream is one of the two outputs. It drops what only means something on a terminal: colours and cursor moves
// (escape sequences, which can span two writes, hence the state per stream), carriage returns and other control
// characters. Each line starts with its time.
type stream struct {
	sink *sink
	// esc: 0 text, 1 after ESC, 2 in a CSI sequence (ESC [), 3 in an OSC one (ESC ]), 4 after ESC inside an OSC.
	esc int
}

func (w *stream) Write(p []byte) (int, error) {
	w.sink.mu.Lock()
	defer w.sink.mu.Unlock()
	out := make([]byte, 0, len(p)+16)
	for _, b := range p {
		switch w.esc {
		case 1:
			w.esc = map[byte]int{'[': 2, ']': 3}[b]
			continue
		case 2:
			if b >= 0x40 && b <= 0x7e {
				w.esc = 0
			}
			continue
		case 3:
			if b == 0x07 {
				w.esc = 0
			} else if b == 0x1b {
				w.esc = 4
			}
			continue
		case 4:
			w.esc = 0
			continue
		}
		switch {
		case b == 0x1b:
			w.esc = 1
		case b == '\n':
			out = append(out, b)
			w.sink.lineStart = true
		case b < 0x20 && b != '\t':
		default:
			if w.sink.lineStart {
				out = append(out, time.Now().Format("15:04:05 ")...)
				w.sink.lineStart = false
			}
			out = append(out, b)
		}
	}
	// Never an error: io.MultiWriter would pass it on, and a command whose output stops being read fails with it.
	_, _ = w.sink.file.Write(out)
	return len(p), nil
}
