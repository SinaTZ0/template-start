package main

import (
	"fmt"
	"strings"
)

/*===== Hidden Characters =====*/

// Persian text can look right and still be wrong: an Arabic yeh or kaf from an Arabic keyboard layout, a direction
// mark or tatweel pasted from Word or Telegram, a ZWNJ, NBSP or BOM, Arabic-Indic digits next to Persian ones. Such
// text renders the same as the correct text, so a bug it causes (a search that finds nothing, two "equal" names) can't
// be seen on the page. The detail page shows any value that holds one a second time, with each such character as a
// visible marker.

// segment is a run of a revealed value: plain text, or one suspicious character (`Hidden`) with its label.
type segment struct {
	Text   string // the text; for a marker, the character itself when it is visible, or "" for one that isn't
	Hidden bool
	Label  string // for a marker: its code point and name, e.g. "U+064A Arabic yeh"
	Title  string // for a marker: the label, plus what Persian uses instead when that isn't obvious
}

// suspicious maps each flagged character to its name, and whether it is drawn (a look-alike) or invisible. Invisible
// ones are left out of the marker's text: a direction control inside it would reorder the marker itself.
var suspicious = map[rune]struct {
	name, persian string // `persian`: what Persian text uses instead, if anything
	visible       bool
}{
	0x064A: {"Arabic yeh", "ی U+06CC", true},
	0x0649: {"Arabic alef maksura", "ی U+06CC", true},
	0x0643: {"Arabic kaf", "ک U+06A9", true},
	0x0640: {"tatweel", "", true},
	0x200C: {"ZWNJ", "", false},
	0x200D: {"ZWJ", "", false},
	0x200E: {"left-to-right mark", "", false},
	0x200F: {"right-to-left mark", "", false},
	0x061C: {"Arabic letter mark", "", false},
	0x202A: {"left-to-right embedding", "", false},
	0x202B: {"right-to-left embedding", "", false},
	0x202C: {"pop directional formatting", "", false},
	0x202D: {"left-to-right override", "", false},
	0x202E: {"right-to-left override", "", false},
	0x2066: {"left-to-right isolate", "", false},
	0x2067: {"right-to-left isolate", "", false},
	0x2068: {"first strong isolate", "", false},
	0x2069: {"pop directional isolate", "", false},
	0x00A0: {"no-break space", "", false},
	0xFEFF: {"BOM", "", false},
}

func isArabicIndicDigit(r rune) bool { return r >= 0x0660 && r <= 0x0669 }
func isPersianDigit(r rune) bool     { return r >= 0x06F0 && r <= 0x06F9 }
func isLatinDigit(r rune) bool       { return r >= '0' && r <= '9' }

// revealHidden splits s into segments with every suspicious character as a marker, or returns nil when s has none,
// so a plain value renders exactly as before. Arabic-Indic digits are always marked; Latin digits only in a string
// that also has Persian digits, since a mix of digit systems is how a number fails to match.
func revealHidden(s string) []segment {
	mixedDigits := strings.ContainsFunc(s, isPersianDigit) && strings.ContainsFunc(s, isLatinDigit)
	found := false
	for _, r := range s {
		if _, ok := suspicious[r]; ok || isArabicIndicDigit(r) || (mixedDigits && isLatinDigit(r)) {
			found = true
			break
		}
	}
	if !found {
		return nil
	}

	var segments []segment
	var plain strings.Builder
	flush := func() {
		if plain.Len() > 0 {
			segments = append(segments, segment{Text: plain.String()})
			plain.Reset()
		}
	}
	for _, r := range s {
		var marker *segment
		switch info, ok := suspicious[r]; {
		case ok:
			marker = &segment{Hidden: true, Label: fmt.Sprintf("U+%04X %s", r, info.name)}
			if info.visible {
				marker.Text = string(r)
			}
			if info.persian != "" {
				marker.Title = marker.Label + "; Persian uses " + info.persian
			}
		case isArabicIndicDigit(r):
			marker = &segment{Text: string(r), Hidden: true, Label: fmt.Sprintf("U+%04X Arabic-Indic digit", r),
				Title: fmt.Sprintf("U+%04X Arabic-Indic digit; Persian uses %c U+%04X", r, r-0x0660+0x06F0, r-0x0660+0x06F0)}
		case mixedDigits && isLatinDigit(r):
			marker = &segment{Text: string(r), Hidden: true, Label: fmt.Sprintf("U+%04X Latin digit", r),
				Title: fmt.Sprintf("U+%04X Latin digit, in text that also has Persian digits", r)}
		}
		if marker == nil {
			plain.WriteRune(r)
			continue
		}
		if marker.Title == "" {
			marker.Title = marker.Label
		}
		flush()
		segments = append(segments, *marker)
	}
	flush()
	return segments
}
