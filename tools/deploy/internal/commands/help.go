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
  recover                       set up a new server from the off-site backups instead: fetch .env (encrypted)
                                and the newest database and media backups from the bucket, load them, build
  update [--yes]                show the new commits and the deploy steps they bring, check the disk has room,
                                ask (not with --yes, or without a terminal), then back up the database, git
                                pull and apply with the pulled tool
  rollback [<version>]          run an earlier image of the app (the newest %d are kept); without a
                                terminal, the version is needed
  env [--check]                 check .env (fill in what can be generated, ask for the rest), edit it in nano
                                or vi, apply it; --check only reports, and exits 1 when something is missing
  apply                         check .env, then rebuild and restart the stack with it
  backup [--all|--db|--media] [--dir <folder>]
                                without a terminal, --db is the default; --dir is remembered in .env; with
                                off-site backups on, what it made is copied to the bucket
  restore [<file> --confirm <domain>]
                                restore a db-… or media-… backup: a file, or a name in the backups' folder or
                                the off-site bucket; without a terminal, both are needed
  verify [<file>]               test that a database backup restores: loads the newest one (or the one named)
                                into a database of its own, counts its tables and rows, and drops it again
  offsite [test|list]           off-site backups, in an S3-compatible bucket (BACKUP_S3_* in .env): on a terminal,
                                set them up, change them or turn them off; test tries the bucket, list lists it
  schedule [on|off]             cron's jobs for this server: a database backup every night, a media backup
                                every Friday, a restore test every Sunday and a check every hour; without an
                                argument it shows them
  check [--test]                what the hourly job runs: tells the chat (ERROR_VIEWER_NOTIFY_URL) when the app
                                is down, the backups stopped, a disk is nearly full or your own certificate
                                runs out, and exits 1 while it's so; --test sends a test message
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
