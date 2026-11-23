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
| `openobserve`  | Optional, off by default: keeps the app's traces, metrics and logs for a week (Traces below)                  |

Only Caddy publishes ports to the internet; OpenObserve and the database browser listen on the server's loopback,
for an SSH tunnel. Postgres and SeaweedFS are reachable from inside the stack only. Each container gets just
the variables it needs, listed in `compose.prod.yaml`. The store's identities (`configs.seaweedfs-s3`) split its
access: `anonymous` may only read the bucket (Caddy's `/media`), `app` may read and write it, and only `storage-init`
gets the `admin` key.

## The Deploy Tool

`deploy/deploy.sh` runs on the server. Without arguments it shows a menu with the stack's status under it; every
action is also a command for cron and scripts (`deploy/deploy.sh help`). The sections below name the action for each
task. The tool's own manual is [deploy-tool.md](./deploy-tool.md): the menu and its status lines, running it over SSH,
its logs, the `.env` check, deploy steps, the database browser and how the tool is built.

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

To set up from the backups of an earlier server instead, choose Recover (Moving to a New Server below).

Once `.env` exists, Set up is locked. If the first build fails, fix the cause and choose Settings → Apply
(`deploy/deploy.sh apply`).

**Without cloning first, and private repositories.** The binary can run on its own, before the repository is on the
server. Copy it there from your machine and run it:

```bash
scp deploy/bin/linux-amd64/deploy <server>:deploy
ssh -t <server> ./deploy     # choose Set up
```

Set up then clones the repository first and continues with the clone's own tool; the copied binary can be deleted
afterwards. It offers the project's own repository, the URL in `tools/deploy/repository.txt`, which is built into the
binary. When the server can't read the repository, because it's private, Set up gives the server a deploy key:

1. It makes an SSH key for the project in `~/.ssh/<repository>_deploy_ed25519` and prints the public half.
2. You add that line to the repository as a deploy key without write access (on GitHub: Settings → Deploy keys; the
   tool prints the page's address).
3. It checks that git can read the repository with the key, then clones over SSH and records the key in the clone's
   git config (`core.sshCommand`), so Update and the status line keep using it.

A deploy key reads one repository, can't push and belongs to no account, so a server that leaks it gives away less
than one holding an access token. It has no passphrase, because Update runs git with nobody there to type one: it's
protected by the server's file permissions only. The first connection records the git host's key in `known_hosts`
without asking; compare it with the host's published fingerprints if the network between them isn't trusted. To end
the server's access, delete the key on the repository.

**By hand.** Copy `.env.production.example` to `.env`, fill in the domains, `SENTRY_DSN` and every secret
(`openssl rand -hex 32`), then:

```bash
docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml ps   # app should turn "healthy"
curl https://<domain>/healthz            # {"status":"ok"}
```

**The first admin.** `pnpm db:seed` doesn't run on the server: it is a TypeScript script, and the image has neither a
TypeScript loader nor pnpm. Sign up on the site, then choose Make admin (`deploy/deploy.sh admin you@example.com`), or by hand:

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
`error-viewer-data` volume, separate from the app's backups. It deletes events older than 30 days or beyond the
newest 50 000, and the oldest ones once the file passes 1 GB (`ERROR_VIEWER_MAX_DB_MB` in `.env`, in MB), so it can't
fill the disk. Losing the volume loses error history, nothing else.

**Release.** Each build carries the commit it was made from (`APP_RELEASE`, set by the deploy tool for the build), and
the viewer shows it on every event: `release:<commit>` in its search box lists what one build reported. A build
started by hand has none unless you pass it: `APP_RELEASE=$(git rev-parse --short=7 HEAD) docker compose … build`.

**Browser stacks.** The app keeps its client source maps next to the built files, and the viewer reads them from the
app inside the stack (`SOURCEMAP_ORIGIN`) to show a browser error's stack as source files and lines. The maps hold the
source, so Caddy answers `404` for every `*.map` from outside (`deploy/Caddyfile`). Keep that rule if you change the
Caddyfile, and add the same to any other proxy you put in front of the app.

**Notifications.** Set `ERROR_VIEWER_NOTIFY_URL` to a chat webhook and the viewer posts a short message when a kind of
error shows up that is new, or back after six hours of silence: the title, where it happened and the link to the
event. A Slack, Mattermost, Rocket.Chat or Google Chat webhook works as it is. For a bot API in Telegram's style, set
the bot's `sendMessage` URL and the chat in `ERROR_VIEWER_NOTIFY_CHAT_ID`. The message leaves the server: an error's
title can hold whatever the error message held. Empty (the default) sends nothing.

## Traces

The app can send its traces, metrics and logs over OpenTelemetry (OTLP/HTTP) to
[OpenObserve](https://openobserve.ai), which runs in the stack as the `openobserve` service. What it exports, and how a request becomes a trace, is in
[logging.md](./backend/logging.md). Where the error viewer shows one failed or slow request, OpenObserve shows every
request: where the time went, across requests, over the last week.

It's off by default, because it needs a few hundred MB of memory (Compose caps it at 768 MB, `mem_limit`), more than a
small server spares. Off, nothing leaves the server, and the request log, the error viewer and its slow-request
timelines work as before. To turn it on, set these in `.env` (Settings: edit `.env`, then apply). The deploy tool
knows them all as optional, so it never asks for them:

| Setting                       | Value                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPOSE_PROFILES`            | `observability`. Compose reads it from `.env` itself and starts `openobserve`                                                                                   |
| `OPENOBSERVE_ROOT_PASSWORD`   | 12 characters or more, with a lowercase and an uppercase letter, a digit and a symbol (OpenObserve refuses to start otherwise). The sign-in is `admin@<DOMAIN>` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://openobserve:5080/api/default`, the service by its name inside the stack                                                                                 |
| `OTEL_EXPORTER_OTLP_HEADERS`  | `Authorization=Basic ` followed by the base64 of `admin@<DOMAIN>:<password>`                                                                                    |
| `ERROR_VIEWER_TRACE_URL`      | `http://localhost:5080/web/traces?org_identifier=default&trace_id={traceId}`                                                                                    |

Make the base64 with `printf 'admin@example.com:the-password' | base64`. These are OpenTelemetry's own variables, so
another OTLP backend (Grafana, SigNoz, a hosted one) is set up the same way, from its own instructions:
`OTEL_EXPORTER_OTLP_HEADERS` is a comma-separated list of `name=value`. `OTEL_SERVICE_NAME` (default `app`) and
`OTEL_RESOURCE_ATTRIBUTES` are read too. The app reads them when it starts (`AppConfig`); with the endpoint empty it
exports nothing, whatever the profile says.

**Opening it.** Like the database browser, OpenObserve listens on the server's loopback only (`127.0.0.1:5080`), and
Caddy doesn't route to it, so nothing on the internet reaches it. Open a tunnel from your computer and sign in:

```bash
ssh -N -L 5080:localhost:5080 you@your-server     # leave it running, then open http://localhost:5080
```

**From a report to its trace.** A request's trace ID is its `X-Request-Id`, the `trace_id` of its log lines and the
`reqId` of its error reports. With `ERROR_VIEWER_TRACE_URL` set, the error viewer adds "Open trace" to a report's `reqId`, which opens
the request's trace through the same tunnel. The URL must contain `{traceId}`, where the ID goes, or the error viewer
refuses to start.

**History.** OpenObserve keeps 7 days (`ZO_COMPACT_DATA_RETENTION_DAYS` in `compose.prod.yaml`), in the
`openobserve-data` volume. Backups don't include it: losing it loses that week's traces, metrics and logs, nothing else.

**Turning it off.** Empty `COMPOSE_PROFILES` and `OTEL_EXPORTER_OTLP_ENDPOINT` and apply, then remove the container,
which a deploy leaves running: `docker compose -f compose.prod.yaml --profile observability rm -sf openobserve`.

## Package Registries

Builds pull base images from Docker Hub (`registry-1.docker.io`) and download packages: npm packages from
`registry.npmjs.org` (the app) and Go modules from `proxy.golang.org` (the error viewer). Where one of them is blocked,
the build either fails with `403 Forbidden` or hangs while pnpm retries for minutes. So before each build (Set up,
Apply, Update) the tool checks all three from the server, which takes a few seconds:

- Docker Hub: `https://registry-1.docker.io/v2/`, which answers `403 Forbidden` where Docker Hub blocks the region
  (skipped once `/etc/docker/daemon.json` already has `registry-mirrors`).
- npm: a request to every IPv4 address of `registry.npmjs.org`. Every one, because a block can be partial (on one
  server, 2 of 12 answered): a single request could pass while pnpm, which spreads its downloads over all of them,
  hangs. IPv4, because builds run on Docker's network, which has no IPv6.
- Go: one large module zip, which `proxy.golang.org` hands over to `storage.googleapis.com`, the part that answers
  `403 Forbidden` where Google blocks the region. Small modules pass even there.

For one that doesn't answer, it offers a mirror and writes it to `/etc/docker/daemon.json` (restarting Docker) or `.env`:

| Target / Setting          | Mirror offered                                          |
| ------------------------- | ------------------------------------------------------- |
| `/etc/docker/daemon.json` | `https://dockerhub.timeweb.cloud`, `https://huecker.io` |
| `NPM_REGISTRY`            | `https://registry.npmmirror.com`                        |
| `GOPROXY`                 | `https://goproxy.cn`                                    |

The build never needs jsDelivr, though `project.inlang/settings.json` names two inlang plugins there: the compiler
tries the CDN first and falls back to the copies committed in `project.inlang/cache/plugins/`
(`docs/frontend/i18n.md`).

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
them). Then it fetches and shows what would arrive, before anything is changed:

- the new commits (the newest 15, and how many more), and a warning when they hold a database migration, which a
  roll back of the app doesn't undo;
- the deploy steps that would run after the build: the ones the commits add and the ones this server still owes
  (Deploy Steps below);
- whether there's room: under 2 GB free on Docker's disk, or less than twice the newest dump free in the backups'
  folder, it lists what takes the space (Docker's build cache and unused images, the backups) and offers to clear
  Docker's leftovers. A build that runs out of disk halfway is harder to read than this.

On a terminal it then asks "Update now?"; `update --yes` skips the question, and without a terminal (cron, CI) there
is none, though too little space still stops it. If the repository refuses the server, it says so and, for a private
repository, prints the deploy key to add again (First Deploy above). After the question it dumps the database (`db-<time>-pre-update.dump`: a migration can't be undone by going back a commit),
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
4. Stop and remove the old container. On SIGTERM it stops taking requests and gets 25 seconds to finish the ones it's
   serving (`SERVER_SHUTDOWN_TIMEOUT` in `compose.prod.yaml`; Docker kills it after `stop_grace_period`, 30 seconds).

A new container that doesn't turn healthy within 3 minutes is removed, its last log lines are printed, and the old one
keeps serving. The migrations it ran stay applied; the pre-update dump has the database from before them. When the app
isn't running (the first deploy, or after a crash), the tool starts the whole stack at once instead. The deploy also
reloads Caddy, which picks up an edited `deploy/Caddyfile` without dropping connections; Compose wouldn't, since the
Caddyfile is a mounted file. The error viewer is restarted in place when its image changes, so it's down for a few
seconds.

## Deploy Steps

Update brings code and migrations, never data the database already holds. A commit that needs a command on the server
(edited seed data loaded again, content rebuilt after a fix to how it's stored) carries it as a step file in
`deploy/steps/`, and every deploy runs the steps this server hasn't run yet, after the new app is healthy. The file
format is in `deploy/steps/README.md`; when steps run, what happens when one fails and how a new server starts are in
[deploy-tool.md](./deploy-tool.md) → Deploy Steps.

A commit that changes a path listed in `deploy/steps/needs-step.txt` must add a step, or say `Deploy-Step: none` on a
line of its message when the server should keep its data; the `commit-msg` hook checks. Rolling back doesn't undo
steps: the data they loaded stays.

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
after you type the domain, the same as Restore: the database becomes exactly what the dump holds, without the tables
and the migration history the newer version added, so the next Update applies those migrations again. Everything
written since that dump is lost, so it's off by default.
Without a terminal it only prints the restore command.

## Settings (.env)

`.env` holds the deployment's settings, read by Compose. Choose Settings (`deploy/deploy.sh env`) to check it, edit it
and apply the edit; Set up, Update and Apply run the same check before every build. What the check tidies, fills in
and asks for is in [deploy-tool.md](./deploy-tool.md) → Settings (.env).

### Adding a Variable

A variable the deployment sets goes in four places: `AppConfig` in `src/server/config.server.ts` (where the server
reads and checks it; a missing or malformed value stops the server at startup), the service's `environment` in
`compose.prod.yaml`, `.env.production.example` (with a comment saying what it is), and the deploy tool's settings
registry (`Registry` in `tools/deploy/internal/settings/settings.go`), with the kind that says how the tool gets a
value. Add it to `.env.example` too, for development. A setting logging needs before the server's runtime exists
(`LOG_LEVEL`) is read in `src/server/observability/settings.server.ts` instead. Then rebuild the tool (`pnpm deploy:build`, [deploy-tool.md](./deploy-tool.md) → How it's built) and commit the
binary with the rest:

- **Required and can't be generated** (a domain, a third-party API key, an external URL): it must be asked for. Use an
  asking kind (`domain`, `required`, `url`) and add a check to `Validate` (`validate.go`, next to the registry) when a
  value can be wrong in a way worth catching early. Set up, Update and Settings then ask for it instead of the deploy
  failing inside Compose with `set X in .env`.
- **Can be generated or has a default**: an entry of the right kind (`secret:<bytes>`, `password:<n>`, `enum:<a,b>`,
  `int`, `default`, `optional`) is all it needs.

Scope `Script` is for variables Compose doesn't read. A variable left out of the registry still gets asked for when
it's empty, but with a warning that the registry misses it.

## Database Changes

Every schema change ships as a migration: generate it into `drizzle/` (`pnpm db:generate --name <what-changed>`), apply
it locally with `pnpm db:migrate`, and commit it with the code that needs it. The rules are in [backend/architecture.md](./backend/architecture.md) →
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

**Nightly backups.** Each run of the tool makes one backup and exits; cron, which every Linux server already has,
runs it on a schedule. `deploy/deploy.sh schedule on` (the Schedule action; Set up offers it) writes these jobs into
your crontab, in the server's time zone (`date` shows it), and `schedule off` removes them:

| When              | Job              | What it does                                           |
| ----------------- | ---------------- | ------------------------------------------------------ |
| Every night 03:00 | `backup --db`    | A database dump. The site keeps running.               |
| Fridays 04:00     | `backup --media` | The image store's volume. Images don't load meanwhile. |
| Sundays 03:30     | `verify`         | Restores the newest dump into a test database.         |
| Every hour        | `check`          | Looks for trouble nobody is watching for (Being told). |

The media backup stops the image store while it copies, which is why it's weekly; the store holds the only copy of
uploaded images, so the job matters as much as the nightly one.

Cron has no terminal, so the tool asks nothing: it writes to `BACKUP_DIR` and keeps the newest `BACKUP_KEEP`. The
jobs' output goes to `cron.log` in the backups' folder. The Schedule status line is yellow while nothing is
scheduled, and Last backup turns yellow when the newest backup is older than two days (a week without a schedule).
The usual reason for a job that fails is a user who can't reach Docker: add the user to the `docker` group, or run
`schedule on` as root.

**Tested backups.** A backup that has never been restored is a guess. Test a backup (`deploy/deploy.sh verify`)
loads the newest database dump into a database of its own, `app_verify`, counts the tables and rows that arrived, and
drops it again; the live database isn't touched and the site keeps running. The schedule runs it every Sunday, half
an hour after that night's dump, and a dump that doesn't restore fails the job, which tells the chat. The Last backup
line says when a restore was last tested ([deploy-tool.md](./deploy-tool.md) → Testing a Backup).

**Being told.** With a chat set in `.env` (`ERROR_VIEWER_NOTIFY_URL`, Error Tracking above), the tool sends it a
message when a scheduled job fails, and when the hourly check finds the app down, no recent backup, a disk 90% full
or your own certificate within 30 days of running out. The check speaks when what it finds changes, not every hour,
and sends an all-clear when it's over. Test the chat with `deploy/deploy.sh check --test`. Without a chat, the same
shows only in `cron.log` and the status lines. The check runs on the server, so it can't report a server that's off:
that needs a monitor outside it.

**Off-site copies.** The backups above are on the server's own disk, so losing the server loses them with it.
Choose Off-site backups (`deploy/deploy.sh offsite`) to have every backup copied to an S3-compatible bucket somewhere
else: Backblaze B2, Cloudflare R2, Wasabi, AWS S3, or MinIO on another machine. Create a private bucket there, and
keys that may read, write and delete in it. The tool asks for the endpoint, the bucket and the keys, writes, lists,
reads and deletes a test file, and only then saves them to `.env` (`BACKUP_S3_*`). From then on:

- Each Back up, by hand or from the schedule, uploads what it made under `<DOMAIN>/` in the bucket, and removes all but
  the newest `BACKUP_S3_KEEP` (30) of each kind there. Several projects can share a bucket.
- A copy of `.env` goes along as `<DOMAIN>/env.age`, encrypted with `BACKUP_ENV_PASSWORD`. `.env` holds what nothing
  else does (the database password, the keys sessions are signed with), and after a lost server that password is the
  only way to read the copy: keep it in a password manager, not only on the server. The tool can generate it, and
  shows it once. `age -d env.age` reads the file on any machine with [age](https://age-encryption.org).
- The dumps and archives are uploaded as they are, not encrypted, so the bucket must stay private.
- An upload that fails doesn't undo the backup: the file is still on the server, the command fails, and from cron the
  chat is told. The Off-site status line shows when a backup last reached the bucket, and the hourly check reports
  it once that's older than two days (a week without a schedule).

The dumps taken before an Update, a restore or the database browser stay on the server only. A whole server
comes back from the bucket with Recover (Moving to a New Server below).

**Restore.** Choose Restore, pick a backup, and type the domain to confirm. With off-site backups on, the list also
has the backups only the bucket still holds, marked "off-site"; picking one downloads it into `BACKUP_DIR` first. A database restore first dumps the current
database (`-pre-restore`), stops the app, loads the dump into a new, empty database, gives that one the live
database's name and starts the app again. The result is exactly what the dump holds: a table added after the dump was
taken is gone, with its line in the migration history, so the next deploy creates it again. A restore that fails
leaves the database as it was. While the dump loads, both copies are on the disk. A media restore offers to back up the current media first, then replaces the volume's
contents. Without a terminal: `deploy/deploy.sh restore <file> --confirm <domain>`, where `<file>` is a path, or the
name of a backup in `BACKUP_DIR` or in the bucket.

By hand:

```bash
docker compose -f compose.prod.yaml exec -T db pg_dump -U app -Fc app > "backup-$(date +%F).dump"
# restore, with the app stopped: an empty database first, so nothing newer than the dump is left in it
docker compose -f compose.prod.yaml stop app
docker compose -f compose.prod.yaml exec -T db psql -U app -d postgres \
  -c "DROP DATABASE app WITH (FORCE)" -c "CREATE DATABASE app"
docker compose -f compose.prod.yaml exec -T db pg_restore -U app -d app --no-owner < backup.dump
docker compose -f compose.prod.yaml start app
```

## Moving to a New Server

With off-site backups on (Backups above), a server can be rebuilt from the bucket: after a lost server, or to move
the site to another one. The new server needs what a first deploy needs (First Deploy above), plus three things
from outside it: the bucket's endpoint and keys, and the password of `.env`'s copy (`BACKUP_ENV_PASSWORD`).

```bash
git clone <repo> app && cd app
deploy/deploy.sh          # choose Recover (deploy/deploy.sh recover)
```

Recover asks for the bucket and the password, shows the newest database dump and media archive it found, and after
a yes writes `.env`, loads both, and builds and starts the stack ([deploy-tool.md](./deploy-tool.md) → Recovering a
Server). The site comes back as it was when those backups were made:

- **The secrets are the old ones**, so accounts keep working and nobody is signed out.
- **What was written after the backups is gone.** With the nightly schedule that's up to a day of the database and
  up to a week of uploaded images.
- **The error viewer starts empty.** Its reports aren't backed up.
- **Certificates are new.** Caddy gets them from Let's Encrypt once the DNS records point at the new server; your
  own certificate files have to be copied over, and Recover asks for their folder.
- **The schedule is new.** Cron's jobs belong to a server; Recover offers them at the end.

**A planned move.** While the old server still runs, lose nothing by taking the backups last:

1. On the old server, stop the app so nothing is written any more:
   `docker compose -f compose.prod.yaml stop app`.
2. Still there: `deploy/deploy.sh backup --all`, which copies a fresh dump, archive and `.env` to the bucket.
3. On the new server: Recover.
4. Point the DNS records of both domains at the new server.
5. On the old server: `deploy/deploy.sh schedule off` and `docker compose -f compose.prod.yaml down`. Two servers
   with the same domain upload into the same folder of the bucket, and the old one's backups would push the new
   one's out.

**Without a copy of `.env` in the bucket**, the old server's secrets have to come from your own copy of `.env`: put
it in the new checkout, then run `deploy/deploy.sh recover`. Without any copy, the database can still be restored
into a server set up from nothing (Set up, then Restore both backups), with new secrets: everyone is signed out.

Recover is worth trying once before it's needed, on a spare server or a virtual machine: it's the only test of the
whole way back.

## Before Going Live

- Set the mailbox the app sends from (`SMTP_*` and `MAIL_FROM` in `.env`; the deploy tool asks for them) and sign up
  once on the live site to see the confirmation email arrive, in the inbox rather than spam ([mail.md](./backend/mail.md)).
- Add a Content-Security-Policy in the app (the inline theme script in `__root.tsx` needs a nonce or hash). Its
  `connect-src` must allow `https://<ERRORS_DOMAIN>`, or browser errors can't be reported. Caddy sets the other
  security headers. The directives it needs are in
  [future-hardening-and-features.md](./future-hardening-and-features.md).
- Set the site's name and description (the `site_name` and `site_description` messages in every locale file) and its
  link-preview image (`siteImage()` in `src/lib/site.ts`), and check `/sitemap.xml` lists every public page ([seo.md](./frontend/seo.md)).
- Turn the schedule on (`deploy/deploy.sh schedule on`), set a chat for its alerts and test it
  (`deploy/deploy.sh check --test`), and turn on off-site backups (`deploy/deploy.sh offsite`), with the password
  of `.env`'s copy kept somewhere that isn't the server (Backups above).
- Go through [future-hardening-and-features.md](./future-hardening-and-features.md) (shared rate limits behind IPv6
  or a CDN, sign-in attempts per account, the CSP) and fix each item or note why it doesn't apply.
