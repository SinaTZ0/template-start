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

| Service        | What it does                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `caddy`        | HTTPS (automatic or your own certificate), compression, security headers, the `/media` path     |
| `app`          | The React Router server (`react-router-serve`) from `Dockerfile`, health-checked on `/healthz`  |
| `migrate`      | Applies pending migrations from `drizzle/` (`deploy/migrate.mjs`), then exits                   |
| `storage-init` | Creates the media bucket if it is missing (`deploy/init-storage.mjs`), then exits               |
| `db`           | Postgres 17                                                                                     |
| `seaweedfs`    | S3-compatible image storage with three identities: `anonymous`, `app` and `admin` (below)       |
| `error-viewer` | Receives and shows the app's server and browser errors and slow requests (Error Tracking below) |

Only Caddy publishes ports. Postgres and SeaweedFS are reachable from inside the stack only. Each container gets just
the variables it needs, listed in `compose.prod.yaml`. The store's identities (`configs.seaweedfs-s3`) split its
access: `anonymous` may only read the bucket (Caddy's `/media`), `app` may read and write it, and only `storage-init`
gets the `admin` key.

## The Deploy Script

`deploy/deploy.sh` runs on the server. Without arguments it shows a menu, with the stack's status under it:

```text
  1) Set up            clone, create .env, first build
  2) Update            back up, pull, rebuild, wait for healthy
  3) Back up           database and/or media
  4) Restore           from a backup file
  5) SSL certificate   automatic or your own files
  6) Status            containers, health, disk
  7) Logs              pick a service, follow
  8) Make admin        promote an account by email
  9) Quit

  ● Project      up to date  (381286c)
  ● Site         https://app.example.com        200 OK
  ● Errors       https://errors.example.com     200 OK
  ● Ports        80 ✓  443 ✓  (Caddy)
  ● SSL          automatic (Let's Encrypt)
  ● Last backup  2026-10-15 03:00  (1 day ago)
```

Green is fine, yellow needs attention (commits to pull, a certificate under 30 days, a backup older than a week), red
is missing or broken. **Project** compares the checkout with its upstream branch. **Site** and **Errors** request
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
folder and an optional Go module mirror, then writes `.env` from `.env.production.example` with every secret generated
(hex, so they're safe inside the database URL and the store's config), builds the stack and waits for it to turn
healthy. It prints the error viewer's password at the end; it's also in `.env`. Keep a copy of `.env` off the server:
without its secrets, a database backup is all that's left.

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
`.env` with the rest, and errors are reported from the start. The viewer also prints it in its log at startup
(`docker compose -f compose.prod.yaml logs error-viewer`). Changing it later needs a redeploy with `--build`: the
server reads it at startup, but the browser bundle has it baked in at build time.

Until `SENTRY_DSN` is set, nothing is reported; errors are still in the logs. The viewer keeps its SQLite file in the
`error-viewer-data` volume, separate from the app's backups, and deletes events older than 30 days or beyond the
newest 50 000 (`RETENTION_DAYS`, `MAX_EVENTS` in `tools/error-viewer/README.md`). Losing the volume loses error
history, nothing else.

**Building where Google is blocked.** The viewer's image pulls everything from Docker Hub, but its build downloads Go
modules from `proxy.golang.org`. If that fails with `403 Forbidden`, set `GOPROXY` in `.env` to a Go module mirror the
server can reach, and deploy again.

## Updating

Choose Update (`deploy/deploy.sh update`). It stops if files on the server were changed (`git pull` could clash with
them), dumps the database first (`db-<time>-pre-update.dump`: a migration can't be undone by going back a commit),
pulls, rebuilds, waits for the app to turn healthy and removes the stack's old images (only its own). By hand:

```bash
git pull
docker compose -f compose.prod.yaml up -d --build
```

Compose builds the new image, runs `migrate` and `storage-init`, and starts the new app container only once both have
succeeded. A failing migration stops the deploy there: the database is unchanged (pending migrations run in one
transaction), and the app isn't started on the new image. Expect a few seconds of downtime while the app container is
replaced.

## Database Changes

Every schema change ships as a migration: generate it into `drizzle/`, apply it locally with `pnpm db:migrate`, and
commit it with the code that needs it. The rules are in [backend/architecture.md](./backend/architecture.md) →
Database. Production runs exactly these files, through the `migrate` job.

Generated SQL can't move data, so for a rename or a backfill, edit the generated file before committing it (or start an
empty one with `pnpm db:generate --custom`).

The old app keeps running while `migrate` applies a new migration, for the seconds until it's replaced. A migration
that drops or renames something the old code still reads can fail its requests in that window. For a busy app, split
such changes over two deploys: first add the new shape and ship code that uses it, then remove the old shape.

## Health Check

`GET /healthz` (`app/routes/healthz/`) answers 200 when the app can query Postgres and 503 otherwise, with a 2-second
limit. Docker polls it every 10 seconds; point an uptime monitor at it too. Storage isn't part of the check: an S3
problem only breaks uploads, and a restart wouldn't fix it. Healthy probes are left out of the app's request log (see
Logs for morgan's line).

## Logs

```bash
docker compose -f compose.prod.yaml logs -f app      # one JSON object per line (docs/backend/logging.md)
```

Errors and slow requests are easier to read in the error viewer (Error Tracking above); the logs keep every request. Docker
rotates every service's log at 10 MB, keeping five files. `react-router-serve` also prints its own short line per
request (morgan) next to the app's request log.

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
- Schedule the orphan-media cleanup if uploads matter (`deleteMedia` in `app/orpc/media/service.ts`).
- Schedule the nightly backup and a copy off the server (Backups above).
