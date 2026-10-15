package main

import (
	"bytes"
	"encoding/json"
	"slices"
	"strconv"
	"strings"
)

/*===== Detail View =====*/

// detailView is the detail page's data, built from the stored payload. Every value in it comes from the SDK and is
// rendered as text: html/template escapes it, and none of it is ever marked as trusted HTML.
type detailView struct {
	Missing    bool
	Event      eventRow
	Message    string // the full message when it says more than the title (several lines)
	Request    string
	Tags       []tagView
	Exceptions []exceptionView
	Timeline   *timelineView
	LogMessage string
	LogFields  []field
	Browser    []field
	Component  string // React's component stack
	Contexts   []contextView
	RawJSON    string
}

type tagView struct {
	Key, Value, Link string
}

type field struct {
	Key, Value string
}

type exceptionView struct {
	Type, Value string
	Mechanism   string
	CausedBy    bool
	Groups      []frameGroup
}

// frameGroup is a run of consecutive frames: the app's own are shown with their source, library frames are collapsed.
type frameGroup struct {
	InApp  bool
	Frames []frameView
}

type frameView struct {
	Function string
	Location string
	Lines    []sourceLine
}

type sourceLine struct {
	Number  int
	Text    string
	Current bool
}

type timelineView struct {
	Breakdown string
	Spans     string
}

type contextView struct {
	Name   string
	Fields []field
}

// tagLinks are the tags whose value links to the list filtered by it, under the search prefix it uses.
var tagLinks = map[string]string{"errorId": "errorId", "reqId": "reqId", "path": "path", "route": "route", "module": "module"}

// contextsShownElsewhere have their own section on the page; browserContexts too, on a browser event.
var (
	contextsShownElsewhere = map[string]bool{"log": true, "timeline": true, "react": true}
	browserContexts        = map[string]bool{"log": true, "timeline": true, "react": true, "browser": true, "os": true}
)

func buildDetail(row eventRow) detailView {
	view := detailView{Event: row, RawJSON: indentJSON(row.Payload)}
	ev, err := decodeEvent(row.Payload)
	if err != nil {
		return view // the raw JSON is still shown
	}

	if message := strings.TrimSpace(ev.message()); message != "" && message != row.Title {
		view.Message = message
	}
	if ev.Request != nil && ev.Request.URL != "" {
		view.Request = strings.TrimSpace(ev.Request.Method + " " + ev.Request.URL)
	}

	/*------ Tags ------*/
	for key, value := range ev.tags() {
		tag := tagView{Key: key, Value: value}
		if prefix, ok := tagLinks[key]; ok && value != "" {
			tag.Link = searchURL(prefix, value)
		}
		view.Tags = append(view.Tags, tag)
	}
	slices.SortFunc(view.Tags, func(a, b tagView) int { return strings.Compare(a.Key, b.Key) })

	/*------ Exceptions ------*/
	// The SDK lists the oldest cause first and the thrown error last; the page starts with the thrown error.
	exceptions := ev.exceptions()
	for i := len(exceptions) - 1; i >= 0; i-- {
		view.Exceptions = append(view.Exceptions, buildException(exceptions[i], i < len(exceptions)-1))
	}

	/*------ Contexts ------*/
	if raw, ok := ev.Contexts["timeline"]; ok {
		var timeline timelineView
		if json.Unmarshal(raw, &timeline) == nil {
			view.Timeline = &timeline
		}
	}
	if raw, ok := ev.Contexts["log"]; ok {
		fields := objectFields(raw)
		for _, f := range fields {
			if f.Key == "message" {
				view.LogMessage = f.Value
			} else {
				view.LogFields = append(view.LogFields, f)
			}
		}
	}
	// The OS belongs with the browser on a browser event; on a server event it is the server's, shown with the other
	// contexts.
	shownElsewhere := contextsShownElsewhere
	if ev.Platform == "javascript" {
		view.Browser = append(view.Browser, nameVersion("Browser", ev.Contexts["browser"])...)
		view.Browser = append(view.Browser, nameVersion("OS", ev.Contexts["os"])...)
		shownElsewhere = browserContexts
	}
	if raw, ok := ev.Contexts["react"]; ok {
		var react struct {
			ComponentStack string `json:"componentStack"`
		}
		if json.Unmarshal(raw, &react) == nil {
			view.Component = strings.Trim(react.ComponentStack, "\n")
		}
	}

	names := make([]string, 0, len(ev.Contexts))
	for name := range ev.Contexts {
		if !shownElsewhere[name] {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	for _, name := range names {
		if fields := objectFields(ev.Contexts[name]); len(fields) > 0 {
			view.Contexts = append(view.Contexts, contextView{Name: name, Fields: fields})
		}
	}
	return view
}

func buildException(ex exception, causedBy bool) exceptionView {
	view := exceptionView{Type: ex.Type, Value: ex.Value, CausedBy: causedBy}
	if ex.Mechanism != nil && ex.Mechanism.Type != "" {
		view.Mechanism = ex.Mechanism.Type
		if ex.Mechanism.Handled != nil && !*ex.Mechanism.Handled {
			view.Mechanism += " (unhandled)"
		}
	}
	if ex.Stacktrace == nil {
		return view
	}

	// Frames come oldest call first; the page shows the innermost call first, as a stack trace reads.
	frames := slices.Clone(ex.Stacktrace.Frames)
	slices.Reverse(frames)
	for _, f := range frames {
		inApp := f.InApp == nil || *f.InApp
		if n := len(view.Groups); n == 0 || view.Groups[n-1].InApp != inApp {
			view.Groups = append(view.Groups, frameGroup{InApp: inApp})
		}
		group := &view.Groups[len(view.Groups)-1]
		group.Frames = append(group.Frames, buildFrame(f, inApp))
	}
	return view
}

func buildFrame(f frame, inApp bool) frameView {
	view := frameView{Function: f.Function}
	if view.Function == "" {
		view.Function = "<anonymous>"
	}

	location := f.Filename
	if location == "" {
		location = f.AbsPath
	}
	if location == "" {
		location = f.Module
	}
	if f.Lineno != nil {
		location += ":" + strconv.Itoa(*f.Lineno)
		if f.Colno != nil {
			location += ":" + strconv.Itoa(*f.Colno)
		}
	}
	view.Location = location

	/*------ Source Lines ------*/
	// Only the app's own frames show source: library code is rarely where the bug is.
	if !inApp || f.ContextLine == nil || f.Lineno == nil {
		return view
	}
	first := *f.Lineno - len(f.PreContext)
	for i, text := range f.PreContext {
		view.Lines = append(view.Lines, sourceLine{Number: first + i, Text: text})
	}
	view.Lines = append(view.Lines, sourceLine{Number: *f.Lineno, Text: *f.ContextLine, Current: true})
	for i, text := range f.PostContext {
		view.Lines = append(view.Lines, sourceLine{Number: *f.Lineno + 1 + i, Text: text})
	}
	return view
}

/*===== Helpers =====*/

// objectFields lists a JSON object's keys in order of name. Strings are shown as they are, anything else as compact
// JSON.
func objectFields(raw json.RawMessage) []field {
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil {
		return nil
	}
	fields := make([]field, 0, len(object))
	for key, value := range object {
		fields = append(fields, field{Key: key, Value: jsonText(value)})
	}
	slices.SortFunc(fields, func(a, b field) int { return strings.Compare(a.Key, b.Key) })
	return fields
}

// nameVersion reads a `{name, version}` context (browser, os) as one field.
func nameVersion(label string, raw json.RawMessage) []field {
	var context struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &context) != nil || context.Name == "" {
		return nil
	}
	return []field{{Key: label, Value: strings.TrimSpace(context.Name + " " + context.Version)}}
}

func indentJSON(payload []byte) string {
	var buf bytes.Buffer
	if json.Indent(&buf, payload, "", "  ") != nil {
		return string(payload)
	}
	return buf.String()
}
