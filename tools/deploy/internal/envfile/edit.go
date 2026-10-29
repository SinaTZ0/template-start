package envfile

import (
	"fmt"
	"os"
	"os/exec"
	"slices"
	"strings"

	"deploy/internal/settings"
	"deploy/internal/ui"
)

// Edit opens a copy of .env in the terminal's editor and, once the editor closes, tidies and checks it, then puts it in
// place of .env in one step (a rename). Editing a copy means a half-done edit or a Ctrl-C never leaves .env broken.
// It reports whether .env changed.
func (s *Settings) Edit() (bool, error) {
	if !ui.Interactive {
		return false, ui.Fail("No terminal for an editor. Edit .env by hand, then check it with deploy/deploy.sh env --check")
	}
	editor, err := pickEditor()
	if err != nil {
		return false, err
	}
	f, err := os.CreateTemp(s.Dir, ".env.edit.")
	if err != nil {
		return false, err
	}
	copyPath := f.Name()
	defer os.Remove(copyPath)
	_, err = f.WriteString(Read(s.Env))
	f.Close()
	if err != nil {
		return false, err
	}

	for {
		if editor == "nano" {
			ui.Info("%s", ui.Dim("Opening .env in nano. Ctrl-O Enter saves, Ctrl-X closes."))
		} else {
			ui.Info("%s", ui.Dim("Opening .env in vi. :wq saves and closes, :q! closes without saving."))
		}
		cmd := exec.Command(editor, copyPath)
		cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			ui.Warn("The editor exited with an error, so .env is unchanged.")
			return false, nil
		}

		/*------ Compare ------*/
		current, edited := Read(s.Env), Read(copyPath)
		if edited == current {
			ui.Info("No changes.")
			return false, nil
		}
		dups := Duplicates(edited)
		edited = Normalize(edited, true)
		if err := os.WriteFile(copyPath, []byte(edited), 0o600); err != nil {
			return false, err
		}
		if edited == current {
			ui.Info("No changes.")
			return false, nil
		}
		ui.Step("Changes")
		ui.Info("%s", ChangeList(current, edited))

		/*------ Check ------*/
		problems := only(s.Problems(copyPath), settings.Ask)
		if len(dups) > 0 {
			problems = append(problems, settings.Problem{Key: strings.Join(dups, " "), Fix: settings.Ask,
				State: settings.Invalid, Reason: "set more than once: only the last line is kept"})
		}
		oldPG, newPG := Parse(current)["POSTGRES_PASSWORD"], Parse(edited)["POSTGRES_PASSWORD"]
		if oldPG != "" && newPG != "" && oldPG != newPG && s.PgdataExists != nil && s.PgdataExists() {
			problems = append(problems, settings.Problem{Key: "POSTGRES_PASSWORD", Fix: settings.Ask,
				State: settings.Invalid, Reason: "changed, but Postgres keeps the password the database was created " +
					"with: change it there too (ALTER USER app PASSWORD '…'), or the app is locked out"})
		}
		if len(problems) == 0 {
			return true, s.saveEdited(copyPath)
		}
		ui.Warn("The edited .env has problems:")
		PrintProblems(problems)
		n, err := ui.Choose("What now?", []string{"Edit again", "Save anyway", "Discard the changes"})
		if err != nil {
			return false, err
		}
		switch n {
		case 1:
			return true, s.saveEdited(copyPath)
		case 2:
			ui.Info("Discarded: .env is unchanged.")
			return false, nil
		}
	}
}

// The system's terminal editor, not $EDITOR: a graphical one (`code`) returns at once, before the file is saved, and
// nano or vi always block until they close.
func pickEditor() (string, error) {
	for _, editor := range []string{"nano", "vi"} {
		if _, err := exec.LookPath(editor); err == nil {
			return editor, nil
		}
	}
	return "", ui.Fail("No terminal editor here (looked for nano and vi). Install one: sudo apt install nano")
}

func (s *Settings) saveEdited(copyPath string) error {
	if err := os.Chmod(copyPath, 0o600); err != nil {
		return err
	}
	// A rename replaces a symlink rather than writing through it, so a linked .env is written in place instead.
	if info, err := os.Lstat(s.Env); err == nil && info.Mode()&os.ModeSymlink != 0 {
		if err := os.WriteFile(s.Env, []byte(Read(copyPath)), 0o600); err != nil {
			return err
		}
	} else if err := os.Rename(copyPath, s.Env); err != nil {
		return err
	}
	ui.OK("Saved .env")
	return nil
}

// ChangeList lists the keys whose values differ between two versions of .env, with secrets masked.
func ChangeList(oldContent, newContent string) string {
	before, after := Parse(oldContent), Parse(newContent)
	var keys []string
	for key := range before {
		keys = append(keys, key)
	}
	for key := range after {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	keys = slices.Compact(keys)

	var b strings.Builder
	for _, key := range keys {
		oldValue, hadOld := before[key]
		newValue, hasNew := after[key]
		switch {
		case !hadOld:
			fmt.Fprintf(&b, "    %-30s added\n", key)
		case !hasNew:
			fmt.Fprintf(&b, "    %-30s removed\n", key)
		case oldValue == newValue:
			continue
		case settings.IsSecretKey(key):
			fmt.Fprintf(&b, "    %-30s changed (hidden)\n", key)
		default:
			fmt.Fprintf(&b, "    %-30s %s → %s\n", key, orEmpty(oldValue), orEmpty(newValue))
		}
	}
	if b.Len() == 0 {
		return "    only comments or layout"
	}
	return strings.TrimRight(b.String(), "\n")
}

func orEmpty(s string) string {
	if s == "" {
		return "(empty)"
	}
	return s
}
