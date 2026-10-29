package steps

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"deploy/internal/interrupt"
	"deploy/internal/stack"
)

// BaselineName is the row that says the ledger was started (see Baseline).
const BaselineName = "_baseline"

// ErrNoLedger is a ledger that can't be read: the database isn't running, or the migration that makes the table
// hasn't run yet.
var ErrNoLedger = errors.New("no ledger")

// Row is a step the server started.
type Row struct {
	Commands, Done int
	Skipped        bool
	Finished       bool
}

// Ledger is the server's record of the steps it ran, the `deploy_step` table (src/db/schema.ts).
type Ledger struct {
	Rows map[string]Row
}

// Started reports whether the ledger has its baseline row.
func (l Ledger) Started() bool {
	_, ok := l.Rows[BaselineName]
	return ok
}

// Read reads the ledger with psql in the db container.
func Read(s *stack.Stack) (Ledger, error) {
	if s.State("db") != "healthy" {
		return Ledger{}, ErrNoLedger
	}
	out, err := psql(s, nil, `select name, commands, done, skipped, finished_at is not null from deploy_step;`)
	if err != nil {
		if errors.Is(err, interrupt.ErrInterrupted) {
			return Ledger{}, err
		}
		// Most likely the table doesn't exist yet: the migration that makes it runs with the first deploy that has it.
		return Ledger{}, fmt.Errorf("%w: %v", ErrNoLedger, err)
	}
	ledger := Ledger{Rows: map[string]Row{}}
	for line := range strings.SplitSeq(out, "\n") {
		if line == "" {
			continue
		}
		f := strings.Split(line, "\t")
		if len(f) != 5 {
			return Ledger{}, fmt.Errorf("unexpected ledger row %q", line)
		}
		commands, _ := strconv.Atoi(f[1])
		done, _ := strconv.Atoi(f[2])
		ledger.Rows[f[0]] = Row{Commands: commands, Done: done, Skipped: f[3] == "t", Finished: f[4] == "t"}
	}
	return ledger, nil
}

// Baseline starts the ledger: the baseline row, and every step in names marked done without running. On a new server
// those steps' changes are already in what Seed loads; on a server that had no ledger yet, they were done by hand.
func Baseline(s *stack.Stack, names []string) error {
	var sql strings.Builder
	sql.WriteString("begin;\n")
	for _, name := range append([]string{BaselineName}, names...) {
		// Names are checked against namePattern (or are the baseline's), so they hold no quote; quote anyway.
		fmt.Fprintf(&sql, "insert into deploy_step (name, commands, done, skipped, finished_at) values (%s, 0, 0, true, now()) "+
			"on conflict (name) do nothing;\n", quote(name))
	}
	sql.WriteString("commit;\n")
	_, err := psql(s, nil, sql.String())
	return err
}

// Progress records that a step has done commands of its commands; the last one finishes it.
func Progress(s *stack.Stack, name string, commands, done int) error {
	finished := "null"
	if done >= commands {
		finished = "now()"
	}
	_, err := psql(s, []string{"name=" + name},
		fmt.Sprintf(`insert into deploy_step (name, commands, done, finished_at) values (:'name', %d, %d, %s) `+
			`on conflict (name) do update set commands = excluded.commands, done = excluded.done, skipped = false, `+
			`finished_at = excluded.finished_at;`, commands, done, finished))
	return err
}

// Forget removes a step's row, so it runs again from its first command.
func Forget(s *stack.Stack, name string) error {
	_, err := psql(s, []string{"name=" + name}, `delete from deploy_step where name = :'name';`)
	return err
}

// psql runs sql in the db container, values passed as psql variables (`:'name'` quotes one), never pasted in. Tab
// separated, unaligned, no headers.
func psql(s *stack.Stack, vars []string, sql string) (string, error) {
	args := []string{"exec", "-T", "db", "psql", "-U", "app", "-d", "app", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "\t"}
	for _, v := range vars {
		args = append(args, "-v", v)
	}
	cmd := s.Command(nil, args...)
	cmd.Stdin = strings.NewReader(sql)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if err := interrupt.Check(err); errors.Is(err, interrupt.ErrInterrupted) {
			return "", err
		}
		return "", fmt.Errorf("psql: %s", strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(string(out)), nil
}

// quote is a SQL string literal.
func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
