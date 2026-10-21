package main

import "testing"

/*===== Hidden Characters =====*/

// An Arabic yeh looks like the Persian one; the reveal must mark it, and only it.
func TestRevealHiddenMarksArabicYeh(t *testing.T) {
	segments := revealHidden("علي")
	want := []segment{{Text: "عل"}, {Text: "ي", Hidden: true, Label: "U+064A Arabic yeh",
		Title: "U+064A Arabic yeh; Persian uses ی U+06CC"}}
	if len(segments) != len(want) || segments[0] != want[0] || segments[1] != want[1] {
		t.Errorf("segments = %+v", segments)
	}
}

// Clean Persian, ZWNJ-free and with Persian digits only, renders as it is.
func TestRevealHiddenLeavesPlainPersianAlone(t *testing.T) {
	if segments := revealHidden("یادداشت من برای ۱۴۰۳"); segments != nil {
		t.Errorf("segments = %+v", segments)
	}
}

// A direction mark is invisible, so the marker carries only its label.
func TestRevealHiddenFindsDirectionMark(t *testing.T) {
	segments := revealHidden("‏سلام")
	if len(segments) != 2 || !segments[0].Hidden || segments[0].Text != "" || segments[0].Label != "U+200F right-to-left mark" {
		t.Errorf("segments = %+v", segments)
	}
}
