# The Deploy Tool

The manual for `deploy/deploy.sh`, which sets up and runs the production stack on its server. What the stack is and
how a deploy works are in [deployment.md](./deployment.md); this file is about the tool itself: its menu and status
lines, the `.env` check, deploy steps and the database browser.

## The Menu

`deploy/deploy.sh` runs on the server. Without arguments it shows a menu, with the stack's status under it:

```text
  1) Set up            clone, create .env, first build
  2) Recover           set up from the off-site backups of a lost or old server
  3) Update            show what's new, back up, pull, rebuild, swap in the new app
  4) Roll back         run an earlier version of the app
  5) Settings          check, edit .env, apply
  6) Back up           database and/or media
  7) Restore           from a backup file
  8) Test a backup     restore the newest database backup into a test database
  9) Off-site backups  copy every backup to an S3-compatible bucket
 10) Schedule          nightly backups and hourly checks, by cron
 11) SSL certificate   automatic or your own files
 12) Status            containers, health, disk
 13) Logs              pick a service, follow
 14) Make admin        promote an account by email
 15) Seed              sample content from the seeds
 16) Deploy steps      list them, run the pending ones
 17) Database browser  browse and edit the database, for a set time
  0) Quit

  ● Project      up to date  (381286c)
  ● App          381286c  healthy
  ● Settings     applied 2026-10-15 14:02
  ● Steps        all done
  ● Site         https://app.example.com        200 OK
  ● Errors       https://errors.example.com     200 OK
  ● Ports        80 ✓  443 ✓  (Caddy)
  ● SSL          automatic (Let's Encrypt)
  ● Last backup  2026-10-15 03:00  (1 day ago)
```

Green is fine, yellow needs attention (commits to pull, an edit to apply, a certificate under 30 days, a backup older
than a week, an open database browser), red is missing or broken. **Project** compares the checkout with its upstream
branch; it's red when the repository turns the server away, which on a private repository means its deploy key was
removed. **App** is the version the app container runs and its health, yellow when it isn't the checkout's
([deployment.md](./deployment.md) → Rolling Back). **Settings** says whether `.env` is complete and whether the running
stack uses it (Settings below). **Steps** says whether every deploy step ran: yellow when some wait for the next
deploy, red when one stopped partway (Deploy Steps below). **Site** and **Errors** request `/healthz` from outside,
through Caddy. **Ports** says whether Caddy holds 80 and 443, or what else does. **Last backup** is when the newest backup was
made, yellow once it's older than two days with a schedule, a week without; once a backup has been restored as a
test (Test a backup), it says how long ago. **Off-site** appears once off-site
backups are set up: when a backup last reached the bucket, yellow by the same ages, red when its settings are half
filled in (Off-site Backups below). **Schedule** says whether cron runs the
backups and the hourly check (Schedule and Alerts below). **Disk** is the fullest of the disks holding the checkout,
the backups and Docker's data: yellow from 80% used, red from 90%. **pgweb** appears only while the
database browser is open, with the time it has left (Database Browser below). Before setup, only Set up and Recover are
available; after it, everything else.

While the menu waits, its status is checked again and redrawn in place when you attach to its tmux window (Closing the
SSH connection below), every 5 minutes, and when you press `r`; under the box is when it was last checked. In the
plain menu (`NO_TUI=1`), Enter alone draws it again.

Every action is also a command, for cron and scripts: `deploy/deploy.sh help` lists them. Without a terminal the tool
never asks: it uses the flags or the defaults, or stops and names the flag it needs. It exits 0 when done, 1 when an
action fails (or `env --check` finds a problem), 2 for a command line it doesn't understand and 130 when Ctrl-C stops
it.

On a terminal the status is drawn in a box with the actions in an arrow-key list under it, answers can be edited in
place (a default is filled in), passwords are hidden as they're typed and the slow steps (waiting for health, dumps,
restores) show a spinner. Esc or Ctrl-C at a prompt gives up on the action and goes back to the menu.
`NO_TUI=1 deploy/deploy.sh` keeps plain numbered prompts (`NO_GUM=1`, from the Bash script, works too), and `NO_COLOR=1`
turns colours off.

**Closing the SSH connection.** Whatever runs on the connection's terminal ends with it, a deploy halfway included.
So the menu (`deploy/deploy.sh` without a command, on a terminal) opens in a tmux window, one per checkout, which
outlives the connection. Quit closes the window; if the tool fails instead, or you quit right after an action failed,
a shell stays with the error on screen, until you type `exit`. After a failed action the menu is drawn under the
error rather than over it. The window runs on the tool's own tmux server (`tmux -L deploy`, set up by
`deploy/tmux.conf`, so your own tmux settings don't apply to it or it to them): it keeps 100,000 lines, the mouse wheel
scrolls back (`q` or scrolling to the bottom ends it), dragging copies to your computer's clipboard where the terminal
allows it, and Shift-drag is the terminal's own selection.
A deploy started from the menu goes on to the end after the connection drops, and running `deploy/deploy.sh` again
reattaches to the window. `Ctrl-b d` leaves it on purpose. A command (`deploy/deploy.sh update`) runs directly, as
cron and scripts need, so it stops with the connection; run a long one from the menu, or inside the window. A command
beside the window (`deploy/deploy.sh status` while a deploy runs in it) is fine. Without tmux installed, the menu asks
each time it opens: install it (with the server's package manager, through `sudo`), or continue without it, in which
case it runs directly. When a deploy does stop halfway, a build or migration that's cut off
changes nothing, but one cut off while swapping in the new app can leave the old and the new app both running, until
Apply runs again.

**Logs of each action.** Every action that changes something, from the menu or as a command, cron's backups
included, writes all it prints, its commands' output included, to `deploy/logs/<date>-<time>-<action>.log`: plain
text, each line with its time, readable only by the server account that ran it. An Update's build and swap, which the
pulled tool runs, go in the Update's file. A failure names its file under the error; `less deploy/logs/<file>` shows
it, and `scp` copies it off the server. The newest 100 are kept. Status, Logs and the hourly Check keep none, and the
database browser's password is shown on screen but never written to a log. While an action logs, the commands it runs
print to the log and the terminal through a pipe, so Docker and git show plain lines instead of their redrawn
progress.

**One action at a time.** An action that changes something holds a lock on the checkout (`deploy/logs/.lock`) until
it ends, so cron's backup can't start in the middle of an Update, and a second terminal can't restore while the first
one deploys. The second action stops at once and names the first: run it again when that one is done. Status, Logs,
Check and `env --check` only look, so they run beside anything, and an open menu holds the lock only while one of its
actions runs. The lock ends with the process, so a tool that crashed or was killed leaves nothing to clean up.

**How it's built.** The tool is a Go program in `tools/deploy/` (one package per area: settings, `.env`, the stack,
certificates, backups, the status lines, the menu). It's built into a static binary per architecture,
`deploy/bin/linux-amd64/deploy`, which is committed, so the server gets it with `git clone` and `git pull` and needs
no Go. `deploy/deploy.sh` only picks the binary for the machine's architecture and runs it. To change the tool, edit
`tools/deploy/`, then build and commit the binary with the source:

```bash
pnpm deploy:build                # amd64; --arch arm64 for an ARM server, --arch all for both
git add tools/deploy deploy/bin
```

`tools/deploy/repository.txt` holds the project's git URL, which the binary offers when Set up runs on a server
with no checkout yet (deployment.md → First Deploy). It's part of the source, so changing it needs a rebuild too.

The build runs `go vet` and the tool's tests first, and writes `SOURCE_HASH` next to each binary. A pre-commit hook
fails a commit that changes `tools/deploy/` without the matching binary, for every architecture that's committed. Every
rebuild adds a full copy of the binary (about 11 MB) to git history, so rebuild only when the source changes. On a
server whose architecture has no binary yet, `deploy/deploy.sh` says which `--arch` to build.

## Settings (.env)

`.env` holds the deployment's settings, read by Compose. Choose Settings (`deploy/deploy.sh env`) to check it, edit it,
and apply the edit. Set up, Update and Apply run the same check before every build:

- **Tidy.** CRLF line endings, trailing spaces, `export `, spaces around `=` and quotes that aren't needed are removed,
  and a variable set twice keeps its last line (after asking), as Compose would read it. Comments and order stay.
- **New variables.** A variable in `.env.production.example` that `.env` doesn't have (one added by a pulled commit) is
  appended with its comment from the example.
- **Fill in.** An empty secret is generated, and an empty setting with a default gets the example's value. Generating
  `ERROR_VIEWER_PUBLIC_KEY` also points `SENTRY_DSN` at it; a `SENTRY_DSN` that doesn't match is offered a fix, and an
  empty one only gets a warning (reporting off). An empty `POSTGRES_PASSWORD` is never generated once the database
  exists: Postgres only reads it when it creates the database, so a new one would lock the app out. The tool asks for
  the original instead.
- **Ask.** What it can't generate it asks for: a domain still set to the example's `example.com`, a value that isn't
  allowed (`TLS_MODE`, `LOG_LEVEL`, `BACKUP_KEEP`), a secret with characters that would break the database URL or the
  store's config, the same domain for the site and the error viewer, a line that isn't `KEY=value`. Answer in the
  terminal or in the editor. Without a terminal it stops instead, naming each variable.

Problems name the variable, never a secret's value. A variable `.env` has but the tool doesn't know (a typo like
`DOMIAN`) only gets a warning.

**Editing.** Edit opens a copy of `.env` in nano (vi when nano isn't installed; `sudo apt install nano`), not
`$EDITOR`, since a graphical editor would return before the file is saved. Save and close it (nano: Ctrl-O Enter, then
Ctrl-X), and the tool carries on: it tidies the copy, lists the variables that changed (secrets masked) and checks
it. When the check fails it offers Edit again, Save anyway or Discard. The copy replaces `.env` in one step, so a
half-done edit or a Ctrl-C leaves `.env` as it was. Changing `POSTGRES_PASSWORD` here doesn't change the database's
password: the tool warns, since the app would be locked out until it's changed in Postgres too.

**Applied or pending.** Every deploy records a fingerprint of what Compose reads from `.env` in `.env.applied`
(gitignored). The Settings status line compares it with `.env`:

| Status line                               | Meaning                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `missing: DOMAIN, …` / `invalid: …` (red) | the next deploy fills these in or asks for them                         |
| `edited <date>, not applied` (yellow)     | `.env` changed since the last deploy: choose Settings → Apply           |
| `applied <date>` (green)                  | the stack runs with this `.env`                                         |
| `edited <date>, not tracked yet` (dim)    | set up before the tool tracked this; the next Update or Apply starts it |

Comments, order, spacing and the backup settings (`BACKUP_DIR`, `BACKUP_KEEP`, read only by the tool) never count as
a change: after such an edit the line stays green and adds `(edited <date>)`. Apply (`deploy/deploy.sh apply`) runs
the check, then rebuilds and restarts the stack, always with `--build`, since `SENTRY_DSN` is baked into the browser
bundle.

**Checking from cron or CI.** `deploy/deploy.sh env --check` asks nothing and changes nothing: it lists what's missing
or invalid and exits 1 if anything is.

A new variable goes in the tool's settings registry: [deployment.md](./deployment.md) → Adding a Variable.

## Schedule and Alerts

Schedule (`deploy/deploy.sh schedule on`) writes the server's cron jobs: a database backup every night at 03:00, a
media backup on Fridays at 04:00, a restore test of the newest database backup on Sundays at 03:30 and a check every
hour ([deployment.md](./deployment.md) → Backups). They're a block
in the crontab of the user who ran it, between two marker lines that name the checkout:

```text
# >>> deploy /home/app/app (deploy/deploy.sh schedule)
0 3 * * * /home/app/app/deploy/deploy.sh backup --db >>/home/app/app/backups/cron.log 2>&1
0 4 * * 5 /home/app/app/deploy/deploy.sh backup --media >>/home/app/app/backups/cron.log 2>&1
30 3 * * 0 /home/app/app/deploy/deploy.sh verify >>/home/app/app/backups/cron.log 2>&1
17 * * * * /home/app/app/deploy/deploy.sh check >>/home/app/app/backups/cron.log 2>&1
# <<< deploy /home/app/app
```

The tool only ever changes that block, so the rest of the crontab is yours, and `schedule on` twice is the same as
once. Don't edit inside the block: the next `schedule on` writes it again. `schedule off` removes it. After an update
that changed the jobs, the Schedule line turns yellow ("out of date") until `schedule on` runs again. A server set up
before the tool kept a schedule has the two backup lines pasted by hand: the line says so, and `schedule on` names
them, to remove with `crontab -e` so the backups don't run twice.

`check` is the hourly job. It reads five status lines (App, Last backup, Off-site, Disk, SSL) and counts as a
problem: the app not running or unhealthy, no backup or one that's too old, an off-site copy that's too old, a disk
90% full, and your own certificate missing, expired or within 30 days of it. It keeps what it found in `deploy/logs/check.state` and sends the chat a message only when
that changes, then an all-clear when nothing is left. It exits 1 while there's a problem, and keeps no log file of
its own. A message that couldn't be sent is tried again the next hour.

Any other command that fails without a terminal, which is how cron runs them, sends its failure and the name of its
log file to the same chat; so does a job that couldn't start because another action held the lock. The chat is the
error viewer's (`ERROR_VIEWER_NOTIFY_URL`, and `ERROR_VIEWER_NOTIFY_CHAT_ID` for a Telegram-style bot), read from
`.env`, so it works with the viewer stopped. `deploy/deploy.sh check --test` sends a test message.

## Testing a Backup

Test a backup (`deploy/deploy.sh verify`) proves that a database backup restores, which a file's size and date
don't. It takes the newest `db-*.dump` in the backups' folder, or the one named (`verify <file>`: a path, a name in
that folder, or a name in the off-site bucket, downloaded first), and:

1. creates an empty database `app_verify` next to the live one,
2. loads the dump into it with `pg_restore`, in one transaction,
3. counts the tables that arrived and the rows in each,
4. drops `app_verify` again, also after a failure or Ctrl-C.

The live database and the app aren't touched, and the site keeps running; while it runs, a second copy of the data
is on the database's disk. A dump that doesn't load, or loads without a single table, fails the command: from the
schedule, which runs it every Sunday, that reaches the chat like any failed job. What passed is kept in
`deploy/logs/verify.state` for the Last backup line. It tests the database only: a media archive is a plain
`tar.gz`, which `tar tzf` reads.

## Off-site Backups

Off-site backups (`deploy/deploy.sh offsite`) copy every backup to an S3-compatible bucket, with an encrypted copy of
`.env` ([deployment.md](./deployment.md) → Backups). The action shows where the copies go and offers:

| Choice   | What it does                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------- |
| Set up   | Asks for the endpoint, bucket, region and keys, tries the bucket, then saves them to `.env`.       |
| Test     | Writes, lists, reads and deletes a small file in the bucket. Also `deploy/deploy.sh offsite test`. |
| Copy now | Uploads the newest database dump and media archive on the server, and `.env`.                      |
| List     | Lists the backups in the bucket, newest first. Also `deploy/deploy.sh offsite list`.               |
| Change   | Set up again, with the current values filled in. Enter at the secret key keeps the one in `.env`.  |
| Turn off | Empties `BACKUP_S3_ENDPOINT`. The other settings and what's in the bucket stay.                    |

The test deletes on purpose: keys that can only write would upload every night, never remove an old backup, and fail
on the day of a restore.

Objects are named `<DOMAIN>/db-<time>.dump`, `<DOMAIN>/media-<time>.tar.gz` and `<DOMAIN>/env.age`. Large archives go
up in parts, so their size isn't limited by one request. After the uploads the tool removes all but the newest
`BACKUP_S3_KEEP` of each kind, going by the time in their names. It records the time of the last upload that worked
in `deploy/logs/offsite.state`; the Off-site status line and the hourly check read that file, not the bucket, so
neither waits on the network.

`.env`'s copy is encrypted with `BACKUP_ENV_PASSWORD` in [age](https://age-encryption.org)'s password format and
written over the last one at each backup. The password is at least 12 characters, without spaces, quotes, `$`, `#`
or backslashes, since it's kept in `.env`. Changing it changes the next copy; the one in the bucket keeps the old
password until then. Without a password, `.env` stays out of the bucket and the status line says "without .env".

The S3 client is [minio-go](https://github.com/minio/minio-go). The region defaults to `us-east-1`, which stores
other than AWS accept; set `BACKUP_S3_REGION` when the provider names one.

## Recovering a Server

Recover (`deploy/deploy.sh recover`) sets up a new server from the off-site backups instead of from nothing
([deployment.md](./deployment.md) → Moving to a New Server). It needs a terminal, and a server whose database is
empty. In order:

1. Outside a checkout it clones the repository, as Set up does, deploy key included.
2. It asks for the bucket (endpoint, bucket, region, keys) and lists the sites in it, which are the bucket's top
   folders. With one site it takes that one; with several it asks.
3. It asks for the password of `.env`'s copy until one opens it.
4. It shows the newest database dump and media archive in the bucket and asks to go ahead. Nothing on the server has
   changed up to here.
5. It writes `.env`, runs the settings check on it, and downloads both backups into `BACKUP_DIR`. When the old
   server's `BACKUP_DIR` can't be made on this one, it asks for another folder. When the old server used its own
   certificate, it asks for the files again or switches to Let's Encrypt: `certs/` is in no backup.
6. It starts only the database, loads the dump into it, starts the image store and loads the archive.
7. It builds and starts the stack. Migrations newer than the dump run, then the deploy steps the old server hadn't
   run: the ledger came back with the database.
8. It offers the schedule, which is cron's and so belongs to each server.

A Recover that stops part-way is run again with `deploy/deploy.sh recover`. It uses the `.env` it already wrote
without asking for the bucket again, and skips a backup that's already downloaded. Once the database holds data it
refuses to load over it and names what's left: `deploy/deploy.sh apply` for the build, and
`deploy/deploy.sh restore <media-….tar.gz>` for the media.

When the bucket has no copy of `.env` (it was left out when off-site backups were set up), put your own copy of the
old server's `.env` in the checkout and run `deploy/deploy.sh recover`: it reads the bucket's settings from that file.

## Deploy Steps

What a step is and its file format are in `deploy/steps/README.md`. This is how the tool runs them.

**The ledger.** The server records the steps it ran in the `deploy_step` table, one row per step with how many of its
commands finished. It's in the database, not a file, so restoring a dump brings back the record that matches the data
in it. The tool reads and writes it with psql; the app never does.

**When they run.** Update and Apply check the pending steps before the build: a step that can't be read, or a command
the tool doesn't accept, stops the deploy while the old app still serves. After the new app is healthy they run, in name
order, all of them, however long they take (a long seed blocks the update until it's done). A step pending is one with
no finished row: a step whose name sorts before one that ran still runs. Several commits pulled at once run their steps
in one go, on the newest code; two steps that load the same thing both run, which only costs time.

**When one fails.** The deploy stops at the failed command and exits 1, saying which step and command failed and how
many steps and commands are left. The new app keeps serving. Fix the cause (a new commit, or the server's state), then
run `deploy/deploy.sh steps` or the next Update: it carries on from the command that failed. A command stopped with
Ctrl-C isn't recorded, so it runs again; every command a step may run is safe to repeat. `deploy/deploy.sh steps --list`
shows each step's state, and `steps --rerun <name>` runs one again from its first command.

**Only the tool's own commands.** A step may run `seed …` ([deployment.md](./deployment.md) → First Deploy, Seed) and
nothing else: no shell, so a step
can't do what the tool can't report on. A new kind of step is a new entry in `stepCommands`
(`tools/deploy/internal/commands/steps.go`), and it must be safe to run twice.

**A new server.** Its first deploy starts the ledger: a `_baseline` row, and every step already in `deploy/steps/`
marked done without running, since Seed loads the data they'd change. The same happens on a server's first deploy with
a version that has the ledger, so a step should arrive in a later update than the ledger itself.

**Writing one.** A commit that changes a path listed in `deploy/steps/needs-step.txt` must add a step, or say
`Deploy-Step: none` on a line of its message when the server should keep its data (editors already changed it there);
the `commit-msg` hook (`scripts/check-deploy-steps.sh`) checks. Steps are never edited once committed, since the ledger
counts their commands: the hook refuses that too. Deleting one is fine. When a command a step uses is renamed, delete
the steps that already ran on the server and update the ones that haven't.

**Roll back** doesn't undo steps: the data they loaded stays.

## Database Browser

For an emergency the app's own pages can't handle (a row to fix by hand, a query to see what went wrong), choose
Database browser (`deploy/deploy.sh pgweb open`). It starts [pgweb](https://github.com/sosedoff/pgweb) with **full read
and write access to the whole database**, as the app's own database user, for 1, 4 or 24 hours (on the command line
`--for 30m`, `--for 4h`; 24 hours at most, and the default).

1. It dumps the database first (`db-<time>-pre-pgweb.dump`), since a mistaken `UPDATE` or `DELETE` is applied at once.
   `--no-backup` skips the dump, for a database too broken to dump.
2. It starts the `pgweb` service, which is in the `tools` profile of `compose.prod.yaml`, so no deploy ever starts it.
   It listens on the server's loopback only (`127.0.0.1:8081`): nothing on the internet can reach it.
3. It prints, once, the SSH tunnel to open from your computer, the address, and a username and password made for this
   session:

   ```bash
   ssh -N -L 8081:localhost:8081 you@your-server     # leave it running, then open http://localhost:8081
   ```

The sign-in reaches the container through the environment of that one `docker compose` call; it isn't written to
`.env`, and it's gone with the container. Lost it? Open the browser again: the old one closes and a new sign-in is made.

**Closing.** Choose Database browser again, or `deploy/deploy.sh pgweb close`. That removes the container, which closes
its database connection: a statement still running finishes first (outside a transaction, its change is kept). It also
closes on its own at the time it printed, in two ways that don't depend on each other. The container runs pgweb under
`timeout`, with `restart: "no"`, so it stops on time even with nobody logged in, and stays down after a reboot. And
every run of the tool, cron's nightly backup included, removes a browser that's past its time. `deploy/deploy.sh pgweb
status` and the pgweb status line say until when it's open. A deploy while it's open (Update, Apply) leaves it running:
`--remove-orphans` removes only containers whose service is gone from `compose.prod.yaml`, and `pgweb` is still there,
in its profile. It keeps its sign-in and closing time.

The database's own login can't be made to expire for the browser alone: it's the app's login, and expiring it would
lock the app out. That's why the time limit lives in the container instead.
