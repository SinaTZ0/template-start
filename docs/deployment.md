# Deployment

How the app runs in production: one server, Docker Compose, Caddy in front. Everything lives in `compose.prod.yaml`,
`Dockerfile` and `deploy/`, and `deploy/deploy.sh` sets it up and runs it (The Deploy Tool below).

## The Stack

```text
internet ──80/443──▶ caddy ──┬── /media/<kind>/<id>/<variant>.webp ──▶ seaweedfs (anonymous read only)
                             ├── everything else ──────────────────▶ app:3000 ──▶ db (Postgres)
                             │                                            └─────▶ seaweedfs (app identity)
                             └── $ERRORS_DOMAIN ───────────────────▶ error-viewer:8000 ──▶ SQLite (its own volume)
one-time jobs, before the app starts:  migrate ──▶ db      storage-init ──▶ seaweedfs (admin identity)
```

| Service        | What it does                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `caddy`        | HTTPS (automatic or your own certificate), compression, security headers, the `/media` path                   |
| `app`          | The TanStack Start server (Nitro, `.output/server/index.mjs`) from `Dockerfile`, health-checked on `/healthz` |
| `migrate`      | Applies pending migrations from `drizzle/` (`deploy/migrate.mjs`), then exits                                 |
| `storage-init` | Creates the media bucket if it is missing (`deploy/init-storage.mjs`), then exits                             |
| `db`           | Postgres 17                                                                                                   |
| `seaweedfs`    | S3-compatible image storage with three identities: `anonymous`, `app` and `admin` (below)                     |
| `error-viewer` | Receives and shows the app's server and browser errors and slow requests (Error Tracking below)               |

Only Caddy publishes ports. Postgres and SeaweedFS are reachable from inside the stack only. Each container gets just
the variables it needs, listed in `compose.prod.yaml`. The store's identities (`configs.seaweedfs-s3`) split its
access: `anonymous` may only read the bucket (Caddy's `/media`), `app` may read and write it, and only `storage-init`
gets the `admin` key.

## The Deploy Tool

`deploy/deploy.sh` runs on the server. Without arguments it shows a menu, with the stack's status under it:

```text
  1) Set up            clone, create .env, first build
  2) Update            back up, pull, rebuild, swap in the new app
  3) Roll back         run an earlier version of the app
  4) Settings          check, edit .env, apply
  5) Back up           database and/or media
  6) Restore           from a backup file
  7) SSL certificate   automatic or your own files
  8) Status            containers, health, disk
  9) Logs              pick a service, follow
 10) Make admin        promote an account by email
 11) Seed              sample content from the seeds
 12) Deploy steps      list them, run the pending ones
 13) Database browser  browse and edit the database, for a set time
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
branch. **App** is the version the app container runs and its health, yellow when it isn't the checkout's (Rolling
Back below). **Settings** says whether `.env` is complete and whether the running stack uses it (Settings below).
**Steps** says whether every deploy step ran: yellow when some wait for the next deploy, red when one stopped partway
(Deploy Steps below).
**Site** and **Errors** request `/healthz` from outside, through Caddy. **Ports** says whether Caddy holds 80 and 443,
or what else does. **pgweb** appears only while the database browser is open, with the time it has left (Database
Browser below). Before setup, only Set up is available; after it, everything else.

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
it, and `scp` copies it off the server. The newest 100 are kept. Status and Logs only look, so they keep none, and the
database browser's password is shown on screen but never written to a log. While an action logs, the commands it runs
print to the log and the terminal through a pipe, so Docker and git show plain lines instead of their redrawn
progress.

**How it's built.** The tool is a Go program in `tools/deploy/` (one package per area: settings, `.env`, the stack,
certificates, backups, the status lines, the menu). It's built into a static binary per architecture,
`deploy/bin/linux-amd64/deploy`, which is committed, so the server gets it with `git clone` and `git pull` and needs
no Go. `deploy/deploy.sh` only picks the binary for the machine's architecture and runs it. To change the tool, edit
`tools/deploy/`, then build and commit the binary with the source:

```bash
pnpm deploy:build                # amd64; --arch arm64 for an ARM server, --arch all for both
git add tools/deploy deploy/bin
```

The build runs `go vet` and the tool's tests first, and writes `SOURCE_HASH` next to each binary. A pre-commit hook
fails a commit that changes `tools/deploy/` without the matching binary, for every architecture that's committed. Every
rebuild adds a full copy of the binary (about 9 MB) to git history, so rebuild only when the source changes. On a
server whose architecture has no binary yet, `deploy/deploy.sh` says which `--arch` to build.

## First Deploy

Needs a server with Docker and Compose 2.23.1 or later and git, DNS records for the domain and the error
viewer's subdomain (`ERRORS_DOMAIN`) pointing at it, and ports 80 and 443 free.

```bash
git clone <repo> app && cd app
deploy/deploy.sh          # choose Set up
```

Set up checks the tools and the ports, asks for the two domains, the certificate (HTTPS Certificates below) and the backup
folder, then writes `.env` from `.env.production.example`. The check every deploy runs
(Settings below) fills in the rest: every secret generated (hex, so they're safe inside the database URL and the
store's config), `SENTRY_DSN`, and anything else the tool can't generate asked for. If a database volume is already
there from an earlier install, it asks for that database's original password instead of generating one. It then offers
to open `.env` in an editor, checks that the server can reach the package registries (Package Registries below), builds
the stack and waits for it to turn healthy. It prints the error viewer's password at
the end; it's also in `.env`. Keep a copy of `.env` off the server: without its secrets, a database backup is all
that's left.

Once `.env` exists, Set up is locked. If the first build fails, fix the cause and choose Settings → Apply
(`deploy/deploy.sh apply`).

The binary (`deploy/bin/linux-amd64/deploy`) can also run on its own, downloaded before the repository: then Set up
clones the repository first and continues with the clone's own tool.

**By hand.** Copy `.env.production.example` to `.env`, fill in the domains, `SENTRY_DSN` and every secret
(`openssl rand -hex 32`), then:

```bash
docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml ps   # app should turn "healthy"
curl https://<domain>/healthz            # {"status":"ok"}
```

**The first admin.** `pnpm db:seed` needs the source tree, which the image doesn't have. Sign up on the site, then
choose Make admin (`deploy/deploy.sh admin you@example.com`), or by hand:

```bash
docker compose -f compose.prod.yaml exec db \
  psql -U app -d app -c "update \"user\" set role = 'admin' where email = 'you@example.com';"
```

**Seed.** A new server's database is empty but for its tables. Seed (`deploy/deploy.sh seed <part>`) loads content
from the seeds bundled into the image: each seed in `src/db/` is built into one plain JavaScript file by the
Dockerfile's esbuild step (`deploy/seed-<part>.mjs`, since the image has no TypeScript loader) and runs in a one-off
container of the app's service, with its settings and networks. The template has one part:

- **Notes.** `deploy/deploy.sh seed notes` (`pnpm db:seed:notes` in development, `src/db/seed-notes.ts`) gives the
  first admin ten sample notes, so make the first admin before it. `--owner <email>` picks another account. An owner
  who has them is skipped; `--replace` deletes the sample notes and loads them again, leaving the owner's own notes.

A project replaces it with its own parts once the note feature is deleted: the seed in `src/db/`, its file in the
Dockerfile's esbuild line, and its part in `Seed` and `checkSeed` (`tools/deploy/internal/commands/misc.go`) and in
the help text. Every part must skip what's loaded, so running it again carries on where it stopped, and a change to its
data after that reaches the server through a deploy step (Deploy Steps below), not by seeding again.

## HTTPS Certificates

`TLS_MODE` in `.env` picks where Caddy's certificates come from, for both domains (`deploy/Caddyfile`):

- **`auto`** (the default): Caddy gets them from Let's Encrypt and renews them. Ports 80 and 443 must be reachable from
  the internet, since Let's Encrypt checks the domains over them.
- **`files`**: your own certificate, in `certs/fullchain.pem` and `certs/key.pem`. Caddy can't renew it: replace it
  before it expires (the SSL status line turns yellow 30 days before).

To use your own, choose SSL certificate (or `deploy/deploy.sh cert <folder>`) and give the folder your CA sent. The
tool recognizes the files by their contents, not their names: the certificate for your domain, the private key that
matches it, and the intermediates that link it to a root. It checks that the certificate covers both `DOMAIN` and
`ERRORS_DOMAIN` (a wildcard covers one level: `*.example.com` covers `errors.example.com`, not
`errors.app.example.com`), that it hasn't expired, and that the chain verifies. Only then does it write the two files
(`chmod 600`, in the gitignored `certs/`) and reload Caddy. The folder is left as it was.

Use PEM or DER files (`.crt`, `.pem`, `.cer`, `.key`). A `.pfx` needs exporting first, and a password-protected key
decrypting; the tool prints the `openssl` commands. Never keep a certificate folder inside the repository: `.key`
and `.pfx` files are gitignored as a safety net, but a private key that reaches git has to be revoked.

Replacing an expiring certificate is the same step with the new folder. `deploy/deploy.sh cert auto` goes back to
Let's Encrypt.

## Error Tracking

The error viewer (`tools/error-viewer`, [logging.md](./backend/logging.md)) runs at `https://<ERRORS_DOMAIN>`. It has
to be public, because browsers send their errors there; everything but the event intake and `/healthz` needs a
sign-in with `ERROR_VIEWER_ADMIN_PASSWORD`.

The DSN is known before the first deploy: `SENTRY_DSN=https://<ERROR_VIEWER_PUBLIC_KEY>@<ERRORS_DOMAIN>/1`. Set it in
`.env` with the rest, and errors are reported from the start (the deploy tool sets it, and offers to fix it when it
doesn't match). The viewer also prints it in its log at startup
(`docker compose -f compose.prod.yaml logs error-viewer`). Changing it later needs a redeploy with `--build`, which
Settings → Apply does: the server reads it at startup, but the browser bundle has it baked in at build time.

Until `SENTRY_DSN` is set, nothing is reported; errors are still in the logs. The viewer keeps its SQLite file in the
`error-viewer-data` volume, separate from the app's backups, and deletes events older than 30 days or beyond the
newest 50 000 (`RETENTION_DAYS`, `MAX_EVENTS` in `tools/error-viewer/README.md`). Losing the volume loses error
history, nothing else.

## Package Registries

The images come from Docker Hub, but their builds download packages: npm packages from `registry.npmjs.org` (the app)
and Go modules from `proxy.golang.org` (the error viewer). Where one of them is blocked, the build doesn't fail fast:
pnpm retries for about ten minutes before it gives up. So before each build (Set up, Apply, Update) the tool checks
both from the server, which takes a few seconds:

- npm: a request to every IPv4 address of `registry.npmjs.org`. Every one, because a block can be partial (on one
  server, 2 of 12 answered): a single request could pass while pnpm, which spreads its downloads over all of them,
  hangs. IPv4, because builds run on Docker's network, which has no IPv6.
- Go: one large module zip, which `proxy.golang.org` hands over to `storage.googleapis.com`, the part that answers
  `403 Forbidden` where Google blocks the region. Small modules pass even there.

For one that doesn't answer, it offers a mirror and writes it to `.env`:

| Setting        | Mirror offered                   |
| -------------- | -------------------------------- |
| `NPM_REGISTRY` | `https://registry.npmmirror.com` |
| `GOPROXY`      | `https://goproxy.cn`             |

Both mirrors are run by third parties in China, so the tool asks instead of switching by itself. Packages are still
checked against the hashes in `pnpm-lock.yaml` and `go.sum`, so a mirror can't swap one. Without a terminal (cron), it
stops before the build and names the setting to add. Once a setting has a value, it isn't checked again: to keep the
default source and skip the check, set it to the default (`NPM_REGISTRY=https://registry.npmjs.org`,
`GOPROXY=https://proxy.golang.org,direct`).

Another mirror works too: set it in `.env` (Settings: edit `.env`, then apply). `NPM_REGISTRY` goes without a trailing
slash, and an npm mirror must also answer corepack's lookup of pnpm itself (`/pnpm/<version>`), which
`mirror-npm.runflare.com` doesn't. If a build still fails on a download, the tool names the setting to add.

## Updating

Choose Update (`deploy/deploy.sh update`). It stops if files on the server were changed (`git pull` could clash with
them), dumps the database first (`db-<time>-pre-update.dump`: a migration can't be undone by going back a commit),
pulls, then hands over to the pulled copy of the tool, which checks `.env` (Settings below), rebuilds, replaces the
app without downtime (below) and removes the stack's old images (only its own). The pulled copy, because its settings
registry knows the variables the new commits added: they're added to `.env` and filled in or asked for before the build. Without
a terminal (cron), a new value it can't generate stops the update after the pull and before the build, naming the
variable: the app that was running keeps running. By hand:

```bash
git pull
docker compose -f compose.prod.yaml up -d --build
```

By hand, Compose builds the new image, runs `migrate` and `storage-init`, and starts the new app container only once
both have succeeded; expect a few seconds of downtime while the app container is replaced.

**Without downtime.** Update and Apply replace a healthy app the way
[docker-rollout](https://github.com/wowu/docker-rollout) does, without installing it:

1. Build the images. A failed build changes nothing.
2. Update every other service (`up --no-deps`, so Compose leaves the app alone), then run `migrate` and
   `storage-init` on the new image. A failing migration stops here: the database is unchanged (pending migrations run
   in one transaction) and the old app keeps serving.
3. Start a second app container on the new image beside the old one, and wait for it to turn healthy. Caddy proxies
   to `app`, which Docker's DNS resolves to both, and retries a request that can't connect for up to 5 seconds
   (`lb_try_duration` in `deploy/Caddyfile`).
4. Stop and remove the old container. It finishes what it's serving on SIGTERM.

A new container that doesn't turn healthy within 3 minutes is removed, its last log lines are printed, and the old one
keeps serving. The migrations it ran stay applied; the pre-update dump has the database from before them. When the app
isn't running (the first deploy, or after a crash), the tool starts the whole stack at once instead. The deploy also
reloads Caddy, which picks up an edited `deploy/Caddyfile` without dropping connections; Compose wouldn't, since the
Caddyfile is a mounted file. The error viewer is restarted in place when its image changes, so it's down for a few
seconds.

## Deploy Steps

Update brings code and migrations, never data the database already holds. A commit that needs a command on the server
(edited seed data loaded again, content rebuilt after a fix to how it's stored) carries it as a step file in
`deploy/steps/`, and every deploy runs the steps this server hasn't run yet. The format is in
`deploy/steps/README.md`:

```md
---
run:
  - seed notes --replace
---

The sample notes were rewritten in src/db/seed-notes.ts. This replaces the first admin's sample notes; their own notes
stay.
```

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

**Only the tool's own commands.** A step may run `seed …` (Seed, under First Deploy above) and nothing else: no shell, so a step
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

## Rolling Back

Every build tags the app's image with the commit it was built from (`template-app:381286c`), and the newest three are
kept (`KeepVersions` in `tools/deploy/internal/stack`); older tags are removed after each deploy, never the running one.
The build cache is trimmed then too, to its 3 GB most recently used (`BuildCacheKeep`), so repeated builds don't fill
the disk. Only `app` builds the image; `migrate` and `storage-init` run the one it built. Choose Roll back
(`deploy/deploy.sh rollback [<version>]`), pick a version, and the tool points the image Compose runs at it and
replaces the app the way Update does, without downtime (an app that's down is simply recreated). It takes seconds:
nothing is built.

Only the app goes back. The checkout, `.env`, the other services and the database stay as they are, and the App status
line turns yellow (`381286c  healthy  (the checkout is 9e5efa5)`) until the checkout runs again. The next Update or
Apply builds and deploys the checkout, so push the fix (or revert the commit) first. Rolling back to the checkout's own
version undoes a roll back.

**The database.** The old version runs on the database as the newer version's migrations left it. That works as long
as they only added things (the two-deploy rule in Database Changes below). When it doesn't, the tool offers the dump
Update took when that version was replaced (the oldest `db-*-pre-update.dump` newer than its image) and restores it
after you type the domain, the same as Restore. Everything written since that dump is lost, so it's off by default.
Without a terminal it only prints the restore command.

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
a change: after such an edit the line stays green and adds `(edited <date>)`. Apply (`deploy/deploy.sh apply`) runs the check, then rebuilds and restarts the stack, always with `--build`,
since `SENTRY_DSN` is baked into the browser bundle.

**Checking from cron or CI.** `deploy/deploy.sh env --check` asks nothing and changes nothing: it lists what's missing
or invalid and exits 1 if anything is.

### Adding a Variable

A variable the deployment sets goes in four places: `src/env.server.ts` (its schema), the service's `environment` in
`compose.prod.yaml`, `.env.production.example` (with a comment saying what it is), and the deploy tool's settings
registry (`Registry` in `tools/deploy/internal/settings/settings.go`), with the kind that says how the tool gets a
value. Then rebuild the tool (`pnpm deploy:build`, The Deploy Tool above) and commit the binary with the rest:

- **Required and can't be generated** (a domain, a third-party API key, an external URL): it must be asked for. Use an
  asking kind (`domain`, `required`, `url`) and add a check to `Validate` (`validate.go`, next to the registry) when a
  value can be wrong in a way worth catching early. Set up, Update and Settings then ask for it instead of the deploy
  failing inside Compose with `set X in .env`.
- **Can be generated or has a default**: an entry of the right kind (`secret:<bytes>`, `password:<n>`, `enum:<a,b>`,
  `int`, `default`, `optional`) is all it needs.

Scope `Script` is for variables Compose doesn't read. A variable left out of the registry still gets asked for when
it's empty, but with a warning that the registry misses it.

## Database Changes

Every schema change ships as a migration: generate it into `drizzle/`, apply it locally with `pnpm db:migrate`, and
commit it with the code that needs it. The rules are in [backend/architecture.md](./backend/architecture.md) →
Database. Production runs exactly these files, through the `migrate` job.

Generated SQL can't move data, so for a rename or a backfill, edit the generated file before committing it (or start an
empty one with `pnpm db:generate --custom`).

The old app keeps running while `migrate` applies a new migration, and keeps serving beside the new one until the new
one is healthy (Updating above). A migration that drops or renames something the old code still reads can fail its
requests in that window. For a busy app, split
such changes over two deploys: first add the new shape and ship code that uses it, then remove the old shape.

## Rate Limiting

The app limits requests per visitor address (`docs/backend/architecture.md` → Rate limiting). Caddy sends the address
in `X-Real-IP` (`deploy/Caddyfile`). The header can be trusted because the app publishes no port, so a visitor can't
reach it without Caddy replacing what they sent. Keep it that way: publishing the app's port would let anyone choose
their own address.

If a production request arrives without the header, the app lets it through without a limit rather than putting every
visitor in one bucket. It reports the problem by changes of state, not per request:

| Log line (`module: "rate-limit"`)                | Level | When                                                                         |
| ------------------------------------------------ | ----- | ---------------------------------------------------------------------------- |
| `client address missing: rate limiting is off …` | error | The first such request. Also sent to the error viewer.                       |
| `client address still missing …`                 | warn  | Every 5 minutes while it lasts, with `requests` counted since the last line. |
| `client address visible again …`                 | info  | The first request with the header after an error was logged.                 |

After fixing the proxy, open any page through it and look for the `visible again` line. Another error or warning
means it isn't fixed. Errors are limited to one per 5 minutes: if addresses go missing again within 5 minutes of the
last error, the new error is logged once those 5 minutes have passed. The Docker healthcheck calls `/healthz` directly
with no header, which is fine: `/healthz` isn't limited.

## Health Check

`GET /healthz` (`src/routes/healthz/`) answers 200 when the app can query Postgres and 503 otherwise, with a 2-second
limit. Docker polls it every 10 seconds; point an uptime monitor at it too. Storage isn't part of the check: an S3
problem only breaks uploads, and a restart wouldn't fix it. Healthy probes are left out of the app's request log.

## Logs

```bash
docker compose -f compose.prod.yaml logs -f app      # one JSON object per line (docs/backend/logging.md)
```

Errors and slow requests are easier to read in the error viewer (Error Tracking above); the logs keep every request. Docker
rotates every service's log at 10 MB, keeping five files.

## Backups

Choose Back up, then database + media, database only, or media only, and the folder (remembered in `.env` as
`BACKUP_DIR`; `./backups` by default, gitignored). Each run keeps the newest `BACKUP_KEEP` (14) of each kind.

- **Database:** `db-<time>.dump`, from `pg_dump -Fc`. The site keeps running.
- **Media:** `media-<time>.tar.gz`, the `seaweedfs` volume. The image store is stopped while it's copied, so the copy
  is consistent; images don't load for that time.

**Nightly backups.** Each run of the tool makes one backup and exits. To get one every night, schedule it with cron,
which every Linux server already has. Once, on the server:

1. Run the backup by hand, the way cron will, to check that it works: `/path/to/app/deploy/deploy.sh backup --db`.
2. Open your crontab with `crontab -e` and add this line (Set up prints it with your paths filled in):

   ```bash
   0 3 * * * /path/to/app/deploy/deploy.sh backup --db >>/path/to/app/backups/cron.log 2>&1
   ```

3. Save and close. Cron picks up the change by itself.

`0 3 * * *` is every day at 03:00, in the server's time zone (`date` shows it). Cron has no terminal, so the tool asks
nothing: it writes to `BACKUP_DIR` and keeps the newest `BACKUP_KEEP`. `--db` keeps the site running; `--all` adds
media, but stops the image store each night while it's copied. The output goes to `cron.log`. If the nightly backups
stop, the Last backup status line turns yellow after 7 days, and `cron.log` shows why. The usual reason is a user who
can't reach Docker: add the user to the `docker` group, or put the line in root's crontab (`sudo crontab -e`).

The backups stay on the server: copy them off it too (another machine, or object storage), or losing the server loses
them with it.

**Restore.** Choose Restore, pick a backup, and type the domain to confirm. A database restore first dumps the current
database (`-pre-restore`), stops the app, loads the dump in one transaction (a failure leaves the database as it was)
and starts the app again. A media restore offers to back up the current media first, then replaces the volume's
contents. Without a terminal: `deploy/deploy.sh restore <file> --confirm <domain>`.

By hand:

```bash
docker compose -f compose.prod.yaml exec -T db pg_dump -U app -Fc app > "backup-$(date +%F).dump"
# restore (drops and recreates every object in the dump):
docker compose -f compose.prod.yaml exec -T db pg_restore -U app -d app --clean --if-exists < backup.dump
```

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

## Before Going Live

- Turn on email verification and password reset once the project can send email (`src/lib/auth.server.ts`).
- Add a Content-Security-Policy in the app (the inline theme script in `__root.tsx` needs a nonce or hash). Its
  `connect-src` must allow `https://<ERRORS_DOMAIN>`, or browser errors can't be reported. Caddy sets the other
  security headers. The directives it needs are in [hardening.md](./hardening.md).
- Set the site's name, description and link-preview image in `src/lib/site.ts`, and check `/sitemap.xml` lists every
  public page ([seo.md](./frontend/seo.md)).
- Schedule the nightly backup and a copy off the server (Backups above).
- Go through [hardening.md](./hardening.md) (shared rate limits behind IPv6 or a CDN, the CSP, sibling
  subdomains) and fix each item or note why it doesn't apply.
