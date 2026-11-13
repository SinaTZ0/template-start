package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

/*===== Opening =====*/

// store is the viewer's SQLite database. Inserts go through one writer goroutine fed by a buffered queue, so an ingest
// request never waits on the disk; reads, deletes and retention use the pool directly (WAL lets them run alongside
// the writer, and busy_timeout covers the rare overlap of two writers).
type store struct {
	db    *sql.DB
	queue chan eventRow
	done  chan struct{}
	log   *slog.Logger
	// Asks the retention loop to run now. The writer sends on it after every pruneAfterBytes it stores, so a flood
	// can't outgrow the size cap between two hourly runs.
	pruneNow chan struct{}
	// Called by the writer for the first event of a kind of error that is new or back after notifyQuiet. Nil without
	// notifications; set before the first enqueue (setAnnouncer).
	announce func(eventRow)
}

const (
	queueSize    = 1000
	maxBatchSize = 100
	// How much the writer stores between two size checks.
	pruneAfterBytes = 32 << 20
	// A kind of error is announced again once it has been silent this long.
	notifyQuiet = 6 * time.Hour
)

var errNotFound = errors.New("event not found")

// openStore opens (creating if needed) the database at path, applies the schema and starts the writer.
func openStore(path string, log *slog.Logger) (*store, error) {
	// `auto_vacuum` comes first: it only takes effect while the file has no tables yet. The pragmas run on every
	// connection the pool opens.
	dsn := "file:" + path + "?_pragma=auto_vacuum(INCREMENTAL)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)" +
		"&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate %s: %w", path, err)
	}

	s := &store{db: db, queue: make(chan eventRow, queueSize), done: make(chan struct{}), log: log,
		pruneNow: make(chan struct{}, 1)}
	go s.runWriter()
	return s, nil
}

// migrate brings the schema up to date, one version at a time. `user_version` records the version reached.
func migrate(db *sql.DB) error {
	var version int
	if err := db.QueryRow("pragma user_version").Scan(&version); err != nil {
		return err
	}
	if version < 1 {
		if err := migrateV1(db); err != nil {
			return err
		}
	}
	if version < 2 {
		// Events stored before this have no client ID, which only means they don't group.
		_, err := db.Exec(`
			alter table events add column client_id text;
			create index if not exists events_client_id on events (client_id, received_at desc) where client_id is not null;
			pragma user_version = 2;
		`)
		if err != nil {
			return err
		}
	}
	if version < 3 {
		// Events stored before this have no user ID; a `userId:` search doesn't find them.
		_, err := db.Exec(`
			alter table events add column user_id text;
			create index if not exists events_user_id on events (user_id, received_at desc) where user_id is not null;
			pragma user_version = 3;
		`)
		if err != nil {
			return err
		}
	}
	if version < 4 {
		// `release` and `group_key` are empty on events stored before this: they show no release and each is a group
		// of its own. `meta` holds the session epoch.
		_, err := db.Exec(`
			alter table events add column release text;
			alter table events add column group_key text;
			create index if not exists events_group on events (group_key, received_at desc) where group_key is not null;
			create index if not exists events_release on events (release, received_at desc) where release is not null;
			create table if not exists meta (key text primary key, value integer not null);
			pragma user_version = 4;
		`)
		if err != nil {
			return err
		}
	}
	return nil
}

func migrateV1(db *sql.DB) error {
	_, err := db.Exec(`
		create table if not exists events (
			id           text primary key,
			received_at  integer not null,
			occurred_at  integer,
			kind         text not null,
			level        text not null,
			platform     text,
			environment  text,
			title        text not null,
			error_id     text,
			req_id       text,
			method       text,
			path         text,
			route        text,
			module       text,
			payload      blob not null
		);
		create index if not exists events_received on events (received_at desc);
		create index if not exists events_error_id on events (error_id) where error_id is not null;
		create index if not exists events_req_id on events (req_id) where req_id is not null;
		create index if not exists events_path on events (path, received_at desc);
		pragma user_version = 1;
	`)
	return err
}

// close stops the writer once the queue is drained, then closes the database. Call it only after the HTTP server has
// shut down: an enqueue after close panics.
func (s *store) close() error {
	close(s.queue)
	<-s.done
	return s.db.Close()
}

/*===== Writing =====*/

// enqueue hands a row to the writer. It returns false when the queue is full, which the ingest endpoint answers
// with 429 so the SDK backs off.
func (s *store) enqueue(row eventRow) bool {
	select {
	case s.queue <- row:
		return true
	default:
		return false
	}
}

// setAnnouncer makes the writer call fn for events worth a notification. Call it before the server starts.
func (s *store) setAnnouncer(fn func(eventRow)) {
	s.announce = fn
}

// runWriter inserts queued rows until the queue is closed, taking whatever has piled up (up to maxBatchSize) into one
// transaction.
func (s *store) runWriter() {
	defer close(s.done)
	batch := make([]eventRow, 0, maxBatchSize)
	written := 0
	for row := range s.queue {
		batch = append(batch[:0], row)
	collect:
		for len(batch) < maxBatchSize {
			select {
			case next, ok := <-s.queue:
				if !ok {
					break collect
				}
				batch = append(batch, next)
			default:
				break collect
			}
		}
		announce := s.worthAnnouncing(batch)
		s.insertAll(batch)
		for _, row := range announce {
			s.announce(row)
		}

		/*------ Size Check ------*/
		for _, row := range batch {
			written += len(row.Payload)
		}
		if written >= pruneAfterBytes {
			written = 0
			select {
			case s.pruneNow <- struct{}{}:
			default:
			}
		}
	}
}

// insertAll stores a batch and doesn't give up on the first failure: the events were already accepted, so the sender
// won't send them again. A failed batch is tried once more (a locked database clears up), then row by row, so one row
// SQLite refuses loses only itself.
func (s *store) insertAll(batch []eventRow) {
	err := s.insert(batch)
	if err == nil {
		return
	}
	s.log.Warn("could not store a batch of events, trying again", "err", err, "count", len(batch))
	time.Sleep(200 * time.Millisecond)
	if err = s.insert(batch); err == nil {
		return
	}

	lost := 0
	for _, row := range batch {
		if rowErr := s.insert([]eventRow{row}); rowErr != nil {
			lost++
			err = rowErr
		}
	}
	if lost > 0 {
		s.log.Error("could not store events", "err", err, "lost", lost, "count", len(batch))
	}
}

// worthAnnouncing picks, before the batch is stored, the errors whose kind (group) has no event in the last
// notifyQuiet: at most one per group.
func (s *store) worthAnnouncing(batch []eventRow) []eventRow {
	if s.announce == nil {
		return nil
	}
	var rows []eventRow
	seen := map[string]bool{}
	for _, row := range batch {
		if row.GroupKey == "" || seen[row.GroupKey] || (row.Level != "error" && row.Level != "fatal") {
			continue
		}
		seen[row.GroupKey] = true
		var last sql.NullInt64
		err := s.db.QueryRow("select max(received_at) from events where group_key = ?", row.GroupKey).Scan(&last)
		if err != nil {
			s.log.Warn("could not look up an event's group", "err", err)
			continue
		}
		if !last.Valid || last.Int64 < row.ReceivedAt-notifyQuiet.Milliseconds() {
			rows = append(rows, row)
		}
	}
	return rows
}

// insert stores rows in one transaction. An ID that is already stored is skipped: SDKs retry a send they believe failed.
func (s *store) insert(rows []eventRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		insert into events (id, received_at, occurred_at, kind, level, platform, environment, title, error_id, req_id,
			method, path, route, module, client_id, user_id, release, group_key, payload)
		values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		on conflict (id) do nothing`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, r := range rows {
		var occurredAt any
		if r.OccurredAt > 0 {
			occurredAt = r.OccurredAt
		}
		_, err := stmt.Exec(r.ID, r.ReceivedAt, occurredAt, r.Kind, r.Level, nullable(r.Platform),
			nullable(r.Environment), r.Title, nullable(r.ErrorID), nullable(r.ReqID), nullable(r.Method),
			nullable(r.Path), nullable(r.Route), nullable(r.Module), nullable(r.ClientID),
			nullable(r.UserID), nullable(r.Release), nullable(r.GroupKey), r.Payload)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// nullable stores an empty string as NULL, so the partial indexes skip it.
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

/*===== Payload Compression =====*/

// maxPayloadBytes caps a stored event's decompressed JSON. It matches the ingest endpoint's decompressed body cap, so
// anything stored can be read back.
const maxPayloadBytes = 8 << 20

func compressPayload(payload []byte) []byte {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	_, _ = w.Write(payload)
	_ = w.Close()
	return buf.Bytes()
}

func decompressPayload(compressed []byte) ([]byte, error) {
	r, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(io.LimitReader(r, maxPayloadBytes))
}

/*===== Filters =====*/

// eventFilter narrows the list. Empty fields don't filter.
type eventFilter struct {
	Level       string
	Kind        string
	Platform    string
	Environment string
	Since       int64 // unix ms; 0 is "all time"
	// One column matched exactly (one of searchColumns), from the search box.
	Column string
	Value  string
	// Matched anywhere in the title.
	Text string
}

// searchColumns are the columns a search may match exactly. It also keeps `Column` from carrying anything else into
// the SQL text.
var searchColumns = map[string]bool{
	"error_id": true, "req_id": true, "path": true, "route": true, "module": true, "client_id": true, "user_id": true,
	"release": true, "group_key": true,
}

// where returns the filter as SQL conditions joined by `and` (starting with `where`, or empty) and their arguments.
func (f eventFilter) where(extra ...string) (string, []any) {
	var conds []string
	var args []any
	add := func(cond string, arg any) {
		conds = append(conds, cond)
		args = append(args, arg)
	}

	if f.Level != "" {
		add("level = ?", f.Level)
	}
	switch f.Kind {
	case "":
	case "browser":
		add("platform = ?", "javascript")
	default:
		add("kind = ?", f.Kind)
	}
	if f.Platform != "" {
		add("platform = ?", f.Platform)
	}
	if f.Environment != "" {
		add("environment = ?", f.Environment)
	}
	if f.Since > 0 {
		add("received_at >= ?", f.Since)
	}
	if f.Column != "" && searchColumns[f.Column] {
		add(f.Column+" = ?", f.Value)
	}
	if f.Text != "" {
		add(`title like ? escape '\'`, "%"+escapeLike(f.Text)+"%")
	}
	conds = append(conds, extra...)

	if len(conds) == 0 {
		return "", args
	}
	return "where " + strings.Join(conds, " and "), args
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

/*===== Cursors =====*/

// cursor is a position in the list, newest first: `received_at` with the ID to break ties.
type cursor struct {
	At int64
	ID string
}

func (c cursor) String() string {
	return strconv.FormatInt(c.At, 10) + "-" + c.ID
}

func parseCursor(s string) (cursor, bool) {
	at, id, ok := strings.Cut(s, "-")
	if !ok {
		return cursor{}, false
	}
	n, err := strconv.ParseInt(at, 10, 64)
	if err != nil || (id != "" && normalizeEventID(id) != id) {
		return cursor{}, false
	}
	return cursor{At: n, ID: id}, true
}

/*===== Reading =====*/

const listColumns = `id, received_at, coalesce(occurred_at, 0), kind, level, coalesce(platform, ''),
	coalesce(environment, ''), title, coalesce(error_id, ''), coalesce(req_id, ''), coalesce(method, ''),
	coalesce(path, ''), coalesce(route, ''), coalesce(module, ''), coalesce(client_id, ''),
	coalesce(user_id, ''), coalesce(release, ''), coalesce(group_key, '')`

// columns are the scan targets for listColumns, in its order.
func (r *eventRow) columns() []any {
	return []any{&r.ID, &r.ReceivedAt, &r.OccurredAt, &r.Kind, &r.Level, &r.Platform, &r.Environment, &r.Title,
		&r.ErrorID, &r.ReqID, &r.Method, &r.Path, &r.Route, &r.Module, &r.ClientID, &r.UserID, &r.Release, &r.GroupKey}
}

// list returns up to limit events matching f, newest first, starting after `before` (nil for the newest). `more`
// reports whether older ones exist. Payloads aren't read.
func (s *store) list(ctx context.Context, f eventFilter, before *cursor, limit int) (events []eventRow, more bool, err error) {
	var extra []string
	var extraArgs []any
	if before != nil {
		extra = append(extra, "(received_at < ? or (received_at = ? and id < ?))")
		extraArgs = append(extraArgs, before.At, before.At, before.ID)
	}
	where, args := f.where(extra...)
	args = append(args, extraArgs...)
	args = append(args, limit+1)

	events, err = s.query(ctx, "select "+listColumns+" from events "+where+
		" order by received_at desc, id desc limit ?", args...)
	if err != nil {
		return nil, false, err
	}
	if len(events) > limit {
		return events[:limit], true, nil
	}
	return events, false, nil
}

// newer returns up to limit events matching f that arrived after `after`, newest first: the rows auto-refresh
// prepends.
func (s *store) newer(ctx context.Context, f eventFilter, after cursor, limit int) ([]eventRow, error) {
	where, args := f.where("(received_at > ? or (received_at = ? and id > ?))")
	args = append(args, after.At, after.At, after.ID, limit)
	return s.query(ctx, "select "+listColumns+" from events "+where+" order by received_at desc, id desc limit ?", args...)
}

func (s *store) query(ctx context.Context, query string, args ...any) ([]eventRow, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []eventRow
	for rows.Next() {
		var r eventRow
		if err := rows.Scan(r.columns()...); err != nil {
			return nil, err
		}
		events = append(events, r)
	}
	return events, rows.Err()
}

// get returns one event with its decompressed payload, or errNotFound.
func (s *store) get(ctx context.Context, id string) (eventRow, error) {
	var r eventRow
	var compressed []byte
	row := s.db.QueryRowContext(ctx, "select "+listColumns+", payload from events where id = ?", id)
	err := row.Scan(append(r.columns(), &compressed)...)
	if errors.Is(err, sql.ErrNoRows) {
		return r, errNotFound
	}
	if err != nil {
		return r, err
	}
	r.Payload, err = decompressPayload(compressed)
	return r, err
}

/*------ Groups ------*/

// eventGroup is a run of alike events (one group_key): its newest event, how many there are and when the first came.
type eventGroup struct {
	eventRow
	Count   int
	FirstAt int64
}

// Key is what the group is listed and paged by: the group key, or the event's own ID for an event stored before
// groups existed.
func (g eventGroup) Key() string {
	if g.GroupKey != "" {
		return g.GroupKey
	}
	return g.ID
}

// groups returns up to limit groups of the events matching f, the most recently seen first, starting after `before`.
// The counts cover the matching events; "first seen" covers every stored event of the group.
func (s *store) groups(ctx context.Context, f eventFilter, before *cursor, limit int) (groups []eventGroup, more bool, err error) {
	where, args := f.where()
	having := ""
	if before != nil {
		having = " having (max(received_at) < ? or (max(received_at) = ? and gk < ?))"
		args = append(args, before.At, before.At, before.ID)
	}
	args = append(args, limit+1)

	// With a single max() in an aggregate query, SQLite takes the other columns from the row that holds the maximum:
	// here, each group's newest event.
	rows, err := s.db.QueryContext(ctx, `
		select g.*, coalesce((select min(received_at) from events f where f.group_key = g.gk), g.last) from (
			select `+listColumns+`, coalesce(group_key, id) as gk, count(*) as n, max(received_at) as last
			from events `+where+` group by gk`+having+` order by last desc, gk desc limit ?
		) g order by g.last desc, g.gk desc`, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	for rows.Next() {
		var g eventGroup
		var key string
		var last int64
		if err := rows.Scan(append(g.columns(), &key, &g.Count, &last, &g.FirstAt)...); err != nil {
			return nil, false, err
		}
		groups = append(groups, g)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	if len(groups) > limit {
		return groups[:limit], true, nil
	}
	return groups, false, nil
}

// countGroup returns how many stored events share a group key.
func (s *store) countGroup(ctx context.Context, groupKey string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "select count(*) from events where group_key = ?", groupKey).Scan(&n)
	return n, err
}

// dayCount is the number of events received on one day.
type dayCount struct {
	Day   time.Time
	Count int
}

// countByDay returns one entry per day for the last `days` days, today last, zero-filled. Days are the reader's own:
// `offset` is how far their clock is ahead of UTC. `Day` holds the day's date as if it were UTC.
func (s *store) countByDay(ctx context.Context, days int, now time.Time, offset time.Duration) ([]dayCount, error) {
	const dayMs = 24 * 60 * 60 * 1000
	shift := offset.Milliseconds()
	today := now.UTC().Add(offset).Truncate(24 * time.Hour)
	first := today.AddDate(0, 0, -(days - 1))

	rows, err := s.db.QueryContext(ctx,
		"select (received_at + ?) / ? as day, count(*) from events where received_at >= ? group by day", shift, dayMs,
		first.UnixMilli()-shift)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := map[int64]int{}
	for rows.Next() {
		var day int64
		var count int
		if err := rows.Scan(&day, &count); err != nil {
			return nil, err
		}
		counts[day] = count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]dayCount, days)
	for i := range result {
		day := first.AddDate(0, 0, i)
		result[i] = dayCount{Day: day, Count: counts[day.UnixMilli()/dayMs]}
	}
	return result, nil
}

// environments lists the environments seen, for the filter menu.
func (s *store) environments(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		"select distinct environment from events where environment is not null order by environment limit 20")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

/*===== Deleting =====*/

func (s *store) delete(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, "delete from events where id = ?", id)
	return err
}

// deleteMatching deletes every event f matches and returns how many.
func (s *store) deleteMatching(ctx context.Context, f eventFilter) (int64, error) {
	where, args := f.where()
	result, err := s.db.ExecContext(ctx, "delete from events "+where, args...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// deleteIDs deletes the events with the given normalized IDs and returns how many were stored.
func (s *store) deleteIDs(ctx context.Context, ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	marks := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	result, err := s.db.ExecContext(ctx, "delete from events where id in ("+marks+")", args...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

/*===== Retention =====*/

// retention is what the store keeps: nothing older than MaxAge, at most MaxEvents, and at most MaxBytes of database.
type retention struct {
	MaxAge    time.Duration
	MaxEvents int
	MaxBytes  int64
}

// prune deletes events older than MaxAge and all but the newest MaxEvents, then the oldest ones until the database
// is under MaxBytes, and returns the freed pages to the file system. Count and age alone don't bound the disk: events
// differ a thousandfold in size.
func (s *store) prune(ctx context.Context, keep retention, now time.Time) (int64, error) {
	old, err := s.db.ExecContext(ctx, "delete from events where received_at < ?", now.Add(-keep.MaxAge).UnixMilli())
	if err != nil {
		return 0, err
	}
	excess, err := s.db.ExecContext(ctx, `delete from events where id in (
		select id from events order by received_at desc, id desc limit -1 offset ?)`, keep.MaxEvents)
	if err != nil {
		return 0, err
	}
	deleted, _ := old.RowsAffected()
	excessCount, _ := excess.RowsAffected()
	deleted += excessCount

	/*------ Size ------*/
	// A few rounds: how much a delete frees is only known afterwards.
	for range 20 {
		used, err := s.usedBytes(ctx)
		if err != nil {
			return deleted, err
		}
		if keep.MaxBytes <= 0 || used <= keep.MaxBytes {
			break
		}
		var count int64
		if err := s.db.QueryRowContext(ctx, "select count(*) from events").Scan(&count); err != nil {
			return deleted, err
		}
		if count == 0 {
			break
		}
		// The share of events that would free the excess if all were the same size, and a tenth more.
		n := min(count, max(count*(used-keep.MaxBytes)/used*11/10, 1))
		oldest, err := s.db.ExecContext(ctx, `delete from events where id in (
			select id from events order by received_at asc, id asc limit ?)`, n)
		if err != nil {
			return deleted, err
		}
		oldestCount, _ := oldest.RowsAffected()
		deleted += oldestCount
	}

	if _, err := s.db.ExecContext(ctx, "pragma incremental_vacuum"); err != nil {
		return deleted, err
	}
	return deleted, nil
}

// usedBytes is the size of the database's pages in use: the file, less the pages a delete has freed and the next
// vacuum returns.
func (s *store) usedBytes(ctx context.Context) (int64, error) {
	var pages, free, pageSize int64
	for pragma, target := range map[string]*int64{"page_count": &pages, "freelist_count": &free, "page_size": &pageSize} {
		if err := s.db.QueryRowContext(ctx, "pragma "+pragma).Scan(target); err != nil {
			return 0, err
		}
	}
	return (pages - free) * pageSize, nil
}

// runRetention prunes once at start, then every hour and whenever the writer asks (pruneNow), until ctx ends.
func (s *store) runRetention(ctx context.Context, keep retention) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		deleted, err := s.prune(ctx, keep, time.Now())
		if err != nil && ctx.Err() == nil {
			s.log.Error("retention failed", "err", err)
		} else if deleted > 0 {
			s.log.Info("retention deleted old events", "count", deleted)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.pruneNow:
		}
	}
}

/*===== Session Epoch =====*/

// sessionEpoch is a counter every session cookie is signed with. Raising it (bumpSessionEpoch, on sign-out) makes
// every cookie signed before worthless, which is how a session is revoked without a session table.
func (s *store) sessionEpoch(ctx context.Context) (int64, error) {
	var epoch int64
	err := s.db.QueryRowContext(ctx, "select value from meta where key = 'session_epoch'").Scan(&epoch)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return epoch, err
}

func (s *store) bumpSessionEpoch(ctx context.Context) (int64, error) {
	var epoch int64
	err := s.db.QueryRowContext(ctx, `insert into meta (key, value) values ('session_epoch', 1)
		on conflict (key) do update set value = value + 1 returning value`).Scan(&epoch)
	return epoch, err
}
