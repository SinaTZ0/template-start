package commands

import (
	"fmt"
	"io"
	"strings"

	"deploy/internal/stack"
)

// Help prints the commands.
func Help(w io.Writer) {
	fmt.Fprintf(w, `Usage: deploy/deploy.sh [command]

With no command, a menu with the stack's status under it.

  setup                         clone (when run outside a checkout), create .env, first build
  update                        back up the database, git pull, then apply with the pulled tool
  rollback [<version>]          run an earlier image of the app (the newest %d are kept); without a
                                terminal, the version is needed
  env [--check]                 check .env (fill in what can be generated, ask for the rest), edit it in nano
                                or vi, apply it; --check only reports, and exits 1 when something is missing
  apply                         check .env, then rebuild and restart the stack with it
  backup [--all|--db|--media] [--dir <folder>]
                                without a terminal, --db is the default; --dir is remembered in .env
  restore [<file> --confirm <domain>]
                                restore a db-… or media-… backup; without a terminal, both are needed
  cert [auto|<folder>]          switch to Let's Encrypt, or install your own certificate from a folder
  status                        containers, disk, backups and the status lines
  logs [<service>]              follow a service's logs: %s
  admin [<email>]               give an account the admin role
  seed [notes]                  load content from the seeds in the app's image; without a part, on a terminal,
                                it asks which
  seed notes [--replace] [--owner <email>]
                                sample notes for the first admin (or the given account); --replace deletes the
                                sample notes and loads them again
  steps [--list | --rerun <name>]
                                the deploy steps in deploy/steps/ and whether they ran; runs the pending ones
                                (update and apply run them too); --rerun runs one again from its first command
  pgweb open [--for <time>] [--no-backup]
                                a database browser with full access, through an SSH tunnel, for 30m, 4h…
                                (24h at most, the default); a database dump first, unless --no-backup
  pgweb close | pgweb status    close it now, or show until when it's open
  help                          this text

NO_COLOR=1 turns colours off; NO_TUI=1 keeps the prompts plain lines.
`, stack.KeepVersions, strings.Join(stack.Services, " "))
}
