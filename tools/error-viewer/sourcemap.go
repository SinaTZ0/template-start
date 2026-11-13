package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

/*===== Source Map =====*/

// sourceMap is a parsed source map (version 3): for a position in a built file, the source file, line and column it
// came from.
type sourceMap struct {
	sources  []string
	contents []string    // each source's text, when the map carries it (`sourcesContent`)
	names    []string    // identifiers as written in the source
	lines    [][]mapping // per line of the built file, ordered by column
}

// mapping says that the built file's text from `col` on (until the next mapping) came from this source position. All
// numbers count from zero. `name` is -1 without one.
type mapping struct {
	col, source, line, column, name int
}

var errBadSourceMap = errors.New("not a source map")

func parseSourceMap(data []byte) (*sourceMap, error) {
	var raw struct {
		Sources        []string `json:"sources"`
		SourcesContent []string `json:"sourcesContent"`
		Names          []string `json:"names"`
		Mappings       string   `json:"mappings"`
	}
	if err := json.Unmarshal(data, &raw); err != nil || raw.Mappings == "" || len(raw.Sources) == 0 {
		return nil, errBadSourceMap
	}
	lines, err := decodeMappings(raw.Mappings, len(raw.Sources), len(raw.Names))
	if err != nil {
		return nil, err
	}
	return &sourceMap{sources: raw.Sources, contents: raw.SourcesContent, names: raw.Names, lines: lines}, nil
}

// lookup returns the mapping that covers a position in the built file: the last one at or before the column.
func (m *sourceMap) lookup(line, col int) (mapping, bool) {
	if line < 0 || line >= len(m.lines) {
		return mapping{}, false
	}
	mappings := m.lines[line]
	i := sort.Search(len(mappings), func(i int) bool { return mappings[i].col > col }) - 1
	if i < 0 {
		return mapping{}, false
	}
	return mappings[i], true
}

/*------ Mappings ------*/

// base64Digit maps a base64 character to its value, or -1.
var base64Digit = func() (table [256]int8) {
	for i := range table {
		table[i] = -1
	}
	for i, c := range "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/" {
		table[c] = int8(i)
	}
	return table
}()

// decodeMappings reads the `mappings` string: lines separated by `;`, segments by `,`, each segment one, four or five
// base64 VLQ numbers (built column, source, source line, source column, name). Every number but the built column is
// relative to the previous segment's, across lines; the built column starts again on each line. Segments without a
// source, or naming one the map doesn't list, are left out.
func decodeMappings(mappings string, sources, names int) ([][]mapping, error) {
	var lines [][]mapping
	var current []mapping
	var col, source, line, column, name int

	var segment [5]int
	fields := 0
	value, shift := 0, 0
	endSegment := func() {
		if fields >= 1 {
			col += segment[0]
		}
		if fields >= 4 {
			source += segment[1]
			line += segment[2]
			column += segment[3]
			m := mapping{col: col, source: source, line: line, column: column, name: -1}
			if fields >= 5 {
				name += segment[4]
				if name >= 0 && name < names {
					m.name = name
				}
			}
			if source >= 0 && source < sources && line >= 0 {
				current = append(current, m)
			}
		}
		fields = 0
	}

	for i := 0; i < len(mappings); i++ {
		switch c := mappings[i]; c {
		case ',':
			endSegment()
		case ';':
			endSegment()
			lines = append(lines, current)
			current, col = nil, 0
		default:
			digit := int(base64Digit[c])
			if digit < 0 || shift > 30 {
				return nil, errBadSourceMap
			}
			value |= (digit & 31) << shift
			if digit&32 != 0 {
				shift += 5
				continue
			}
			// The lowest bit is the sign.
			if value&1 == 1 {
				value = -(value >> 1)
			} else {
				value >>= 1
			}
			if fields < len(segment) {
				segment[fields] = value
			}
			fields++
			value, shift = 0, 0
		}
	}
	endSegment()
	return append(lines, current), nil
}

/*===== Symbolicator =====*/

// symbolicator rewrites a browser event's minified stack frames to the source they came from, when the event
// arrives. The app keeps its client source maps next to the built files and Caddy refuses them to the outside
// (deploy/Caddyfile), so the viewer fetches them from the app over the internal network. Mapping at arrival, not when
// the event is read, is what keeps old events readable: a deploy replaces the built files and their maps.
type symbolicator struct {
	origin string
	client *http.Client
	log    *slog.Logger

	mu    sync.Mutex
	cache map[string]*cachedMap
}

// cachedMap is a fetched map, or a miss (`m` nil), which is asked for again after missTTL.
type cachedMap struct {
	m       *sourceMap
	fetched time.Time
	used    time.Time
}

const (
	maxCachedMaps  = 24
	maxMapBytes    = 16 << 20
	missTTL        = time.Minute
	contextLines   = 5
	contextMaxLine = 300
)

// assetPath is the only shape of path the viewer asks the app for: a plain `.js` file, to which `.map` is added.
// Frames come from anyone who can send an event, so a frame must not be able to name any other URL of the app.
var assetPath = regexp.MustCompile(`^(?:/[A-Za-z0-9_~.-]+)+\.m?js$`)

func newSymbolicator(origin *url.URL, log *slog.Logger) *symbolicator {
	return &symbolicator{
		origin: strings.TrimSuffix(origin.String(), "/"),
		client: &http.Client{
			Timeout: 3 * time.Second,
			// A redirect could lead anywhere; the app serves its maps directly.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		log:   log,
		cache: map[string]*cachedMap{},
	}
}

// apply returns the event with its frames mapped, or the payload as it was when it isn't a browser event or nothing
// could be mapped.
func (s *symbolicator) apply(payload []byte) []byte {
	if !bytes.Contains(payload, []byte(`"javascript"`)) {
		return payload
	}
	// Numbers stay as written, so the rest of the event is re-encoded unchanged.
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var event map[string]any
	if decoder.Decode(&event) != nil || event["platform"] != "javascript" {
		return payload
	}

	changed := false
	for _, frames := range eventFrames(event) {
		if s.mapFrames(frames) {
			changed = true
		}
	}
	if !changed {
		return payload
	}
	mapped, err := json.Marshal(event)
	if err != nil {
		return payload
	}
	return mapped
}

// eventFrames returns the frame lists of every exception in a decoded event.
func eventFrames(event map[string]any) [][]any {
	var values []any
	switch exception := event["exception"].(type) {
	case map[string]any:
		values, _ = exception["values"].([]any)
	case []any:
		values = exception
	}

	var all [][]any
	for _, value := range values {
		exception, _ := value.(map[string]any)
		stacktrace, _ := exception["stacktrace"].(map[string]any)
		if frames, ok := stacktrace["frames"].([]any); ok {
			all = append(all, frames)
		}
	}
	return all
}

// mapFrames rewrites the frames it finds a map for, in place: file, line and column become the source's, the source
// lines around it are attached, and code from `node_modules` is marked as not the app's. The minified position is
// kept under `data.minified`.
func (s *symbolicator) mapFrames(frames []any) bool {
	changed := false
	// The identifier at each frame's position, which is the name of what that frame was calling.
	called := make([]string, len(frames))

	for i, raw := range frames {
		f, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		file, _ := f["abs_path"].(string)
		if file == "" {
			file, _ = f["filename"].(string)
		}
		line, col := jsonInt(f["lineno"]), jsonInt(f["colno"])
		u, err := url.Parse(file)
		if err != nil || line < 1 || !assetPath.MatchString(u.Path) || strings.Contains(u.Path, "..") {
			continue
		}
		m := s.sourceMap(u.Path)
		if m == nil {
			continue
		}
		at, ok := m.lookup(line-1, max(col-1, 0))
		if !ok {
			continue
		}

		source := m.sources[at.source]
		inApp := !strings.Contains(source, "node_modules/")
		f["filename"] = cleanSource(source)
		f["lineno"] = at.line + 1
		f["colno"] = at.column + 1
		f["in_app"] = inApp
		f["data"] = map[string]any{"minified": fmt.Sprintf("%s:%d:%d", u.Path, line, col)}
		if at.name >= 0 {
			called[i] = m.names[at.name]
		}
		if inApp && at.source < len(m.contents) && m.contents[at.source] != "" {
			addContext(f, m.contents[at.source], at.line)
		}
		changed = true
	}

	// A minified frame's own name (`a`, `Xe`) says nothing. Frames run from the oldest call to the innermost, so the
	// identifier at the previous frame's position names this frame's function.
	for i := 1; i < len(frames); i++ {
		if f, ok := frames[i].(map[string]any); ok && called[i-1] != "" {
			f["function"] = called[i-1]
		}
	}
	return changed
}

// addContext attaches the source line (counted from zero) and the lines around it, as the SDKs do for server frames.
func addContext(f map[string]any, content string, line int) {
	lines := strings.Split(content, "\n")
	if line >= len(lines) {
		return
	}
	clipAll := func(lines []string) []string {
		clipped := make([]string, len(lines))
		for i, text := range lines {
			clipped[i] = clip(strings.TrimSuffix(text, "\r"), contextMaxLine)
		}
		return clipped
	}
	f["pre_context"] = clipAll(lines[max(0, line-contextLines):line])
	f["context_line"] = clip(strings.TrimSuffix(lines[line], "\r"), contextMaxLine)
	f["post_context"] = clipAll(lines[line+1 : min(len(lines), line+1+contextLines)])
}

// cleanSource turns a map's source path, which is relative to the built file (`../../src/routes/notes/notes.tsx`),
// into one that reads from the repository root.
func cleanSource(source string) string {
	source, _, _ = strings.Cut(source, "?")
	for {
		switch {
		case strings.HasPrefix(source, "../"):
			source = source[3:]
		case strings.HasPrefix(source, "./"):
			source = source[2:]
		default:
			return source
		}
	}
}

func jsonInt(value any) int {
	switch n := value.(type) {
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	case float64:
		return int(n)
	}
	return 0
}

/*------ Fetching ------*/

// sourceMap returns the map for a built file's path, or nil when the app has none. One fetch runs at a time: a new
// build's first errors all need the same few maps.
func (s *symbolicator) sourceMap(path string) *sourceMap {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if cached, ok := s.cache[path]; ok && (cached.m != nil || now.Sub(cached.fetched) < missTTL) {
		cached.used = now
		return cached.m
	}

	m, err := s.fetch(path)
	if err != nil {
		s.log.Debug("no source map", "path", path, "err", err)
	}
	if len(s.cache) >= maxCachedMaps {
		oldest := ""
		for key, cached := range s.cache {
			if oldest == "" || cached.used.Before(s.cache[oldest].used) {
				oldest = key
			}
		}
		delete(s.cache, oldest)
	}
	s.cache[path] = &cachedMap{m: m, fetched: now, used: now}
	return m
}

func (s *symbolicator) fetch(path string) (*sourceMap, error) {
	res, err := s.client.Get(s.origin + path + ".map")
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxMapBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxMapBytes {
		return nil, errTooLarge
	}
	return parseSourceMap(data)
}
