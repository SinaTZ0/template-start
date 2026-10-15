# Deployment

How the app runs in production: one server, Docker Compose, Caddy in front. Everything lives in `compose.prod.yaml`,
`Dockerfile` and `deploy/`.

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
| `caddy`        | HTTPS (automatic certificates), compression, security headers, the read-only `/media` path      |
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

## First Deploy

Needs a server with Docker and Compose 2.23.1 or later, DNS records for the domain and the error viewer's subdomain
(`ERRORS_DOMAIN`) pointing at it, and ports 80 and 443 open (Caddy proves the domains over them to get its
certificates).

```bash
git clone <repo> app && cd app
cp .env.production.example .env      # fill in the domains, SENTRY_DSN and every secret (`openssl rand -hex 32`)
docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml ps   # app should turn "healthy"
curl https://<domain>/healthz            # {"status":"ok"}
```

**The first admin.** `pnpm db:seed` needs the source tree, which the image doesn't have. Sign up on the site, then
promote the account:

```bash
docker compose -f compose.prod.yaml exec db \
  psql -U app -d app -c "update \"user\" set role = 'admin' where email = 'you@example.com';"
```

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

Not automated by the stack. At least, dump the database daily to somewhere off the server:

```bash
docker compose -f compose.prod.yaml exec -T db pg_dump -U app -Fc app > "backup-$(date +%F).dump"
# restore (drops and recreates every object in the dump):
docker compose -f compose.prod.yaml exec -T db pg_restore -U app -d app --clean --if-exists < backup.dump
```

Images live in the `seaweedfs` volume. Back it up as well (or move to a hosted S3 store, which only changes `S3_*`
settings and the `/media` proxy target).

## Before Going Live

- Turn on email verification and password reset once the project can send email (`app/lib/auth.server.ts`).
- Add a Content-Security-Policy in the app (the inline theme script in `root.tsx` needs a nonce or hash). Its
  `connect-src` must allow `https://<ERRORS_DOMAIN>`, or browser errors can't be reported. Caddy sets the other
  security headers.
- Schedule the orphan-media cleanup if uploads matter (`deleteMedia` in `app/orpc/media/service.ts`).
- Set up the backups above.
