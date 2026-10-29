package ui

import (
	"regexp"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/rivo/uniseg"
)

var ansi = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// Box draws lines in a rounded box. A box as wide as its longest line breaks apart on a narrower terminal, so a line
// that doesn't fit (a long list of missing settings) makes the box the terminal's width, and the line wraps inside it.
func Box(lines []string) string {
	style := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(0, 1)
	if color {
		style = style.BorderForeground(lipgloss.Color("240"))
	}
	longest := 0
	for _, line := range lines {
		longest = max(longest, uniseg.StringWidth(ansi.ReplaceAllString(line, "")))
	}
	if cols := Width(); longest+4 > cols {
		style = style.Width(cols - 2)
	}
	return style.Render(strings.Join(lines, "\n"))
}
