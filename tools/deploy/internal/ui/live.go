package ui

import (
	"errors"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

	"deploy/internal/interrupt"
)

// Above is text drawn over a field that changes while the field waits, like the menu's status.
type Above struct {
	Text string
	// Updates each replace Text in place. The sender closes it once the field is answered, or the wait for the next
	// one would outlive the field.
	Updates <-chan string
	// Keys are handled here, before the field sees them, with no effect on it.
	Keys map[string]func()
}

// RunFieldUnder shows a huh field as its own form under above, which changes in place. Esc and Ctrl-C give up, as
// in run. The field's own filter (`/`) is off, so plain letters are free for above's keys.
func RunFieldUnder(field huh.Field, above Above) error {
	keys := keyMap()
	keys.Select.Filter.SetEnabled(false)
	form := huh.NewForm(huh.NewGroup(field)).WithKeyMap(keys).WithShowHelp(false)
	form.SubmitCmd, form.CancelCmd = tea.Quit, tea.Quit
	_, err := tea.NewProgram(&underModel{form: form, above: above}, tea.WithContext(interrupt.Context())).Run()
	if form.State == huh.StateAborted || interrupt.Happened() || errors.Is(err, tea.ErrInterrupted) {
		return interrupt.ErrInterrupted
	}
	return err
}

type aboveText string

type underModel struct {
	form  *huh.Form
	above Above
}

// next waits for the next text; nil once the channel is closed.
func (m *underModel) next() tea.Msg {
	text, ok := <-m.above.Updates
	if !ok {
		return nil
	}
	return aboveText(text)
}

func (m *underModel) Init() tea.Cmd { return tea.Batch(m.form.Init(), m.next) }

func (m *underModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case aboveText:
		m.above.Text = string(msg)
		return m, m.next
	case tea.KeyPressMsg:
		if fn := m.above.Keys[msg.String()]; fn != nil {
			fn()
			return m, nil
		}
	}
	form, cmd := m.form.Update(msg)
	m.form = form.(*huh.Form)
	return m, cmd
}

func (m *underModel) View() tea.View { return tea.NewView(m.above.Text + "\n" + m.form.View()) }
