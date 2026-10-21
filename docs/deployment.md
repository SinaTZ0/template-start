# Deployment

How the app runs in production: one server, Docker Compose, Caddy in front. Everything lives in `compose.prod.yaml`,
`Dockerfile` and `deploy/`, and `deploy/deploy.sh` sets it up and runs it (The Deploy Script below).

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

## The Deploy Script

`deploy/deploy.sh` runs on the server. Without arguments it shows a menu, with the stack's status under it:

```text
  1) Set up            clone, create .env, first build
  2) Update            back up, pull, rebuild, wait for healthy
  3) Settings          check, edit .env, apply
  4) Back up           database and/or media
  5) Restore           from a backup file
  6) SSL certificate   automatic or your own files
  7) Status            containers, health, disk
  8) Logs              pick a service, follow
  9) Make admin        promote an account by email
  0) Quit

  ● Project      up to date  (381286c)
  ● Settings     applied 2026-10-15 14:02
  ● Site         https://app.example.com        200 OK
  ● Errors       https://errors.example.com     200 OK
  ● Ports        80 ✓  443 ✓  (Caddy)
  ● SSL          automatic (Let's Encrypt)
  ● Last backup  2026-10-15 03:00  (1 day ago)
```

Green is fine, yellow needs attention (commits to pull, an edit to apply, a certificate under 30 days, a backup older
than a week), red is missing or broken. **Project** compares the checkout with its upstream branch. **Settings** says
whether `.env` is complete and whether the running stack uses it (Settings below). **Site** and **Errors** request
`/healthz` from outside, through Caddy. **Ports** says whether Caddy holds 80 and 443, or what else does. Before setup,
only Set up is available; after it, everything else.

Every action is also a command, for cron and scripts: `deploy/deploy.sh help` lists them. Without a terminal the
script never asks: it uses the flags or the defaults, or stops and names the flag it needs.

## First Deploy

Needs a server with Docker and Compose 2.23.1 or later, git, openssl and curl, DNS records for the domain and the error
viewer's subdomain (`ERRORS_DOMAIN`) pointing at it, and ports 80 and 443 free.

```bash
git clone <repo> app && cd app
deploy/deploy.sh          # choose Set up
```

Set up checks the tools and the ports, asks for the two domains, the certificate (HTTPS Certificates below), the backup
folder and an optional Go module mirror, then writes `.env` from `.env.production.example`. The check every deploy runs
(Settings below) fills in the rest: every secret generated (hex, so they're safe inside the database URL and the
store's config), `SENTRY_DSN`, and anything else the script can't generate asked for. If a database volume is already
there from an earlier install, it asks for that database's original password instead of generating one. It then offers
to open `.env` in an editor, builds the stack and waits for it to turn healthy. It prints the error viewer's password at
the end; it's also in `.env`. Keep a copy of `.env` off the server: without its secrets, a database backup is all
that's left.

Once `.env` exists, Set up is locked. If the first build fails, fix the cause and choose Settings → Apply
(`deploy/deploy.sh apply`).

The script can also run on its own, downloaded before the repository: then Set up clones the repository first.

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

## HTTPS Certificates

`TLS_MODE` in `.env` picks where Caddy's certificates come from, for both domains (`deploy/Caddyfile`):

- **`auto`** (the default): Caddy gets them from Let's Encrypt and renews them. Ports 80 and 443 must be reachable from
  the internet, since Let's Encrypt checks the domains over them.
- **`files`**: your own certificate, in `certs/fullchain.pem` and `certs/key.pem`. Caddy can't renew it: replace it
  before it expires (the SSL status line turns yellow 30 days before).

To use your own, choose SSL certificate (or `deploy/deploy.sh cert <folder>`) and give the folder your CA sent. The
script recognizes the files by their contents, not their names: the certificate for your domain, the private key that
matches it, and the intermediates that link it to a root. It checks that the certificate covers both `DOMAIN` and
`ERRORS_DOMAIN` (a wildcard covers one level: `*.example.com` covers `errors.example.com`, not
`errors.app.example.com`), that it hasn't expired, and that the chain verifies. Only then does it write the two files
(`chmod 600`, in the gitignored `certs/`) and reload Caddy. The folder is left as it was.

Use PEM or DER files (`.crt`, `.pem`, `.cer`, `.key`). A `.pfx` needs exporting first, and a password-protected key
decrypting; the script prints the `openssl` commands. Never keep a certificate folder inside the repository: `.key`
and `.pfx` files are gitignored as a safety net, but a private key that reaches git has to be revoked.

Replacing an expiring certificate is the same step with the new folder. `deploy/deploy.sh cert auto` goes back to
Let's Encrypt.

## Error Tracking

The error viewer (`tools/error-viewer`, [logging.md](./backend/logging.md)) runs at `https://<ERRORS_DOMAIN>`. It has
to be public, because browsers send their errors there; everything but the event intake and `/healthz` needs a
sign-in with `ERROR_VIEWER_ADMIN_PASSWORD`.

The DSN is known before the first deploy: `SENTRY_DSN=https://<ERROR_VIEWER_PUBLIC_KEY>@<ERRORS_DOMAIN>/1`. Set it in
`.env` with the rest, and errors are reported from the start (the deploy script sets it, and offers to fix it when it
doesn't match). The viewer also prints it in its log at startup
(`docker compose -f compose.prod.yaml logs error-viewer`). Changing it later needs a redeploy with `--build`, which
Settings → Apply does: the server reads it at startup, but the browser bundle has it baked in at build time.

Until `SENTRY_DSN` is set, nothing is reported; errors are still in the logs. The viewer keeps its SQLite file in the
`error-viewer-data` volume, separate from the app's backups, and deletes events older than 30 days or beyond the
newest 50 000 (`RETENTION_DAYS`, `MAX_EVENTS` in `tools/error-viewer/README.md`). Losing the volume loses error
history, nothing else.

**Building where Google is blocked.** The viewer's image pulls everything from Docker Hub, but its build downloads Go
modules from `proxy.golang.org`. If that fails with `403 Forbidden`, set `GOPROXY` in `.env` to a Go module mirror the
server can reach, and deploy again (Settings: edit `.env`, then apply).

## Updating

Choose Update (`deploy/deploy.sh update`). It stops if files on the server were changed (`git pull` could clash with
them), dumps the database first (`db-<time>-pre-update.dump`: a migration can't be undone by going back a commit),
pulls, then hands over to the pulled copy of the script, which checks `.env` (Settings below), rebuilds, waits for the
app to turn healthy and removes the stack's old images (only its own). The pulled copy, because its settings registry
knows the variables the new commits added: they're added to `.env` and filled in or asked for before the build. Without
a terminal (cron), a new value it can't generate stops the update after the pull and before the build, naming the
variable: the app that was running keeps running. By hand:

```bash
git pull
docker compose -f compose.prod.yaml up -d --build
```

Compose builds the new image, runs `migrate` and `storage-init`, and starts the new app container only once both have
succeeded. A failing migration stops the deploy there: the database is unchanged (pending migrations run in one
transaction), and the app isn't started on the new image. Expect a few seconds of downtime while the app container is
replaced.

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
  exists: Postgres only reads it when it creates the database, so a new one would lock the app out. The script asks for
  the original instead.
- **Ask.** What it can't generate it asks for: a domain still set to the example's `example.com`, a value that isn't
  allowed (`TLS_MODE`, `LOG_LEVEL`, `BACKUP_KEEP`), a secret with characters that would break the database URL or the
  store's config, the same domain for the site and the error viewer, a line that isn't `KEY=value`. Answer in the
  terminal or in the editor. Without a terminal it stops instead, naming each variable.

Problems name the variable, never a secret's value. A variable `.env` has but the script doesn't know (a typo like
`DOMIAN`) only gets a warning.

**Editing.** Edit opens a copy of `.env` in nano (vi when nano isn't installed; `sudo apt install nano`), not
`$EDITOR`, since a graphical editor would return before the file is saved. Save and close it (nano: Ctrl-O Enter, then
Ctrl-X), and the script carries on: it tidies the copy, lists the variables that changed (secrets masked) and checks
it. When the check fails it offers Edit again, Save anyway or Discard. The copy replaces `.env` in one step, so a
half-done edit or a Ctrl-C leaves `.env` as it was. Changing `POSTGRES_PASSWORD` here doesn't change the database's
password: the script warns, since the app would be locked out until it's changed in Postgres too.

**Applied or pending.** Every deploy records a fingerprint of what Compose reads from `.env` in `.env.applied`
(gitignored). The Settings status line compares it with `.env`:

| Status line                               | Meaning                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `missing: DOMAIN, …` / `invalid: …` (red) | the next deploy fills these in or asks for them                           |
| `edited <date>, not applied` (yellow)     | `.env` changed since the last deploy: choose Settings → Apply             |
| `applied <date>` (green)                  | the stack runs with this `.env`                                           |
| `edited <date>, not tracked yet` (dim)    | set up before the script tracked this; the next Update or Apply starts it |

Comments, order, spacing and the backup settings (`BACKUP_DIR`, `BACKUP_KEEP`, read only by the script) never count as
a change: after such an edit the line stays green and adds `(edited <date>)`. Apply (`deploy/deploy.sh apply`) runs the check, then rebuilds and restarts the stack, always with `--build`,
since `SENTRY_DSN` is baked into the browser bundle.

**Checking from cron or CI.** `deploy/deploy.sh env --check` asks nothing and changes nothing: it lists what's missing
or invalid and exits 1 if anything is.

### Adding a Variable

A variable the deployment sets goes in four places: `app/env.server.ts` (its schema), the service's `environment` in
`compose.prod.yaml`, `.env.production.example` (with a comment saying what it is), and the settings registry at the top
of `deploy/deploy.sh` (`SETTINGS`), with the kind that says how the script gets a value:

- **Required and can't be generated** (a domain, a third-party API key, an external URL): it must be asked for. Use an
  asking kind (`domain`, `required`, `url`) and add a check to `validate_setting` when a value can be wrong in a way
  worth catching early. Set up, Update and Settings then ask for it instead of the deploy failing inside Compose with
  `set X in .env`.
- **Can be generated or has a default**: an entry of the right kind (`secret:<bytes>`, `password:<n>`, `enum:<a,b>`,
  `int`, `default`, `optional`) is all it needs.

Scope `script` is for variables Compose doesn't read. A variable left out of the registry still gets asked for when
it's empty, but with a warning that the registry misses it.

## Database Changes

Every schema change ships as a migration: generate it into `drizzle/`, apply it locally with `pnpm db:migrate`, and
commit it with the code that needs it. The rules are in [backend/architecture.md](./backend/architecture.md) →
Database. Production runs exactly these files, through the `migrate` job.

Generated SQL can't move data, so for a rename or a backfill, edit the generated file before committing it (or start an
empty one with `pnpm db:generate --custom`).

The old app keeps running while `migrate` applies a new migration, for the seconds until it's replaced. A migration
that drops or renames something the old code still reads can fail its requests in that window. For a busy app, split
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

`GET /healthz` (`app/routes/healthz/`) answers 200 when the app can query Postgres and 503 otherwise, with a 2-second
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

**Nightly backups.** Each run of the script makes one backup and exits. To get one every night, schedule it with cron,
which every Linux server already has. Once, on the server:

1. Run the backup by hand, the way cron will, to check that it works: `/path/to/app/deploy/deploy.sh backup --db`.
2. Open your crontab with `crontab -e` and add this line (Set up prints it with your paths filled in):

   ```bash
   0 3 * * * /path/to/app/deploy/deploy.sh backup --db >>/path/to/app/backups/cron.log 2>&1
   ```

3. Save and close. Cron picks up the change by itself.

`0 3 * * *` is every day at 03:00, in the server's time zone (`date` shows it). Cron has no terminal, so the script asks
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

## Before Going Live

- Turn on email verification and password reset once the project can send email (`app/lib/auth.server.ts`).
- Add a Content-Security-Policy in the app (the inline theme script in `root.tsx` needs a nonce or hash). Its
  `connect-src` must allow `https://<ERRORS_DOMAIN>`, or browser errors can't be reported. Caddy sets the other
  security headers.
- Set the site's name, description and link-preview image in `app/lib/site.ts`, and check `/sitemap.xml` lists every
  public page ([seo.md](./frontend/seo.md)).
- Schedule the orphan-media cleanup if uploads matter (`deleteMedia` in `app/orpc/media/service.ts`).
- Schedule the nightly backup and a copy off the server (Backups above).
