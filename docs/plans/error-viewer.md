# Plan: Error Viewer

A small Go service that replaces Bugsink: it receives the error reports the app already sends, stores them in SQLite,
and shows them on a simple dashboard to list, search and inspect. It is a plan, not built yet. Delete this file once
the viewer is built and `docs/backend/logging.md` describes it.

## Why

- **Bugsink does more than needed.** Issues, grouping and "seen before" tracking go unused. What's wanted is a list of
  errors, a search by `errorId` / `reqId` / path, and a detail page with everything the app sends.
- **It must not depend on the app.** The viewer is its own process with its own SQLite file, so it keeps working when the
  app or its Postgres is slow or down. An admin page inside the app was rejected for exactly that reason.
- **Full control over the look,** and lighter than Bugsink (one ~15 MB container, ~20–40 MB of RAM, no database server).

## Decisions

| Topic       | Decision                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Location    | `tools/error-viewer/` in this repo, its own Go module, deployed by both compose files                                                                        |
| Apps served | This app only: one project ID (`1`), one key                                                                                                                 |
| Data in     | Sentry's envelope protocol. The app's SDKs (`@sentry/node`, `@sentry/browser`) stay as they are; only `SENTRY_DSN` changes. Bugsink stays a drop-in fallback |
| Storage     | SQLite (`modernc.org/sqlite`, pure Go: no cgo, static binary), one file in a volume                                                                          |
| UI          | Server-rendered `html/template` + htmx (vendored file, embedded in the binary; no CDN), hand-written CSS                                                     |
| HTTP        | Standard library `net/http` with Go 1.22+ route patterns. No framework                                                                                       |
| Pino logs   | Not sent. Logs stay on stdout (Docker); the viewer gets errors and slow requests through the SDK only                                                        |

## What the App Sends Today

Nothing in the app changes. These are the events the viewer must handle (see `app/lib/error-reporting.server.ts` and
`app/entry.client.tsx`):

| Event         | Sent by                                                              | Useful fields                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server error  | Every `log.error({ err }, …)` (`reportError`)                        | `exception.values` (cause chain, oldest first, the thrown error last), `tags.errorId`, `tags.reqId`, `tags.method`, `tags.path`, `tags.module`, `contexts.log` (log message and fields) |
| Slow request  | `reportSlowRequest`                                                  | `message` (`Slow request: GET /notes (3012ms)`), `level: warning`, `tags.route`, `contexts.timeline.breakdown`, `contexts.timeline.spans` (multi-line, NBSP-padded tree)                |
| Browser error | `@sentry/browser` global handlers, `onCaughtError`                   | `exception.values`, `request.url`, `contexts.react.componentStack`, `platform: javascript`, browser and OS contexts                                                                     |
| Crashes       | `@sentry/node`'s uncaught-exception and unhandled-rejection handlers | `exception.values`, `level: fatal`                                                                                                                                                      |

The SDKs also send envelope items the viewer doesn't need (`session`, `sessions`, `client_report`, `transaction`,
`attachment`, …). They are accepted and dropped.

## Ingest

### Endpoint

`POST /api/{projectId}/envelope/`. The DSN is `<scheme>://<key>@<host>/<projectId>`, e.g.
`http://<key>@localhost:8000/1`.

- **Auth:** the key arrives in the `X-Sentry-Auth` header (`Sentry sentry_key=<key>, sentry_version=7, …`) or as the
  `sentry_key` query parameter (the browser SDK uses this to avoid a CORS preflight). Reject a wrong key or project ID
  with 401 / 404. Compare the key in constant time.
- **CORS:** answer `OPTIONS` and add `Access-Control-Allow-Origin: <ALLOWED_ORIGIN>` to responses, so the browser SDK can
  post from the app's origin.
- **Body:** cap the raw body at 1 MB. The node SDK may gzip it (`Content-Encoding: gzip`): decompress with a cap on the
  decompressed size too (zip-bomb guard), reject other encodings with 415.
- **Response:** `200 {"id": "<event_id>"}`. When over the rate limit: `429` with `Retry-After`, which the SDKs honor by
  backing off.

### Envelope Format

Newline-separated:

```text
{"event_id":"…","sent_at":"…","dsn":"…","sdk":{…}}       ← envelope header
{"type":"event","length":1234}                          ← item header ("length" in bytes is optional)
{…event JSON…}                                           ← item payload: `length` bytes, or up to the next newline
{"type":"client_report"}
{…}
```

Keep items of type `event` only. Parse defensively: a malformed item is skipped, not fatal for the rest.

### Writing

- **Never block the request on SQLite.** The handler parses, validates and pushes the event onto a buffered channel
  (e.g. 1000); one writer goroutine inserts in small batches inside a transaction. A full channel answers 429.
- **Rate limit** per client IP (token bucket, e.g. 60 events/minute, burst 20) plus a global cap, so a browser error
  in a render loop can't flood the disk. Behind Caddy, read the client IP from `X-Real-IP` only when the request comes
  from the proxy.
- **Deduplicate** on `event_id` (`INSERT … ON CONFLICT DO NOTHING`): the SDKs may retry.

## Storage

One SQLite file at `$DATA_DIR/errors.db`, opened with `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`,
`foreign_keys=ON`, `auto_vacuum=INCREMENTAL` (set before the first table is created). One process, local disk: the
standard SQLite case.

```sql
create table events (
  id           text primary key,          -- event_id from the SDK
  received_at  integer not null,          -- unix ms, set by the viewer (the list's order)
  occurred_at  integer,                   -- the event's own `timestamp`
  kind         text not null,             -- 'error' | 'slow' | 'message' (slow = fingerprint[0] 'slow-request')
  level        text not null,             -- fatal | error | warning | info
  platform     text,                      -- node | javascript
  environment  text,
  title        text not null,             -- "TypeError: x is undefined" or the message
  error_id     text,                      -- tags.errorId
  req_id       text,                      -- tags.reqId
  method       text,
  path         text,                      -- tags.path, or the path of request.url for browser events
  route        text,                      -- tags.route (slow requests)
  module       text,                      -- tags.module
  payload      blob not null              -- the full event JSON, gzip-compressed
);
create index events_received on events (received_at desc);
create index events_error_id on events (error_id) where error_id is not null;
create index events_req_id on events (req_id) where req_id is not null;
create index events_path on events (path, received_at desc);
```

- **Title:** for an exception, the **last** value's `type: value` (the thrown error; earlier values are its causes),
  first line only, cut at 200 chars. Otherwise `message` (string, or `.formatted` / `logentry.formatted`).
- **Tags** arrive as an object or as `[key, value]` pairs: accept both.
- **Payload** is the source of truth for the detail page; the columns exist only to list, filter and search.
- **Retention:** every hour delete rows older than `RETENTION_DAYS` (default 30) and beyond the newest `MAX_EVENTS`
  (default 50 000), then `PRAGMA incremental_vacuum`.

## Dashboard

LTR and English is fine (it's a developer tool, not the app). All pages need a sign-in.

### List: `GET /`

- Newest first, 50 per page, cursor pagination on `(received_at, id)` with a "Load more" button (htmx, appends rows).
- Columns: time (relative, exact on hover), level badge, kind (error / slow / browser), title, path, `errorId`
  (shortened, copy button).
- **Search box** (htmx, `hx-trigger="input changed delay:300ms"`, swaps the table body). One input that understands:
  - a UUID → exact `error_id` match, or an 8-char hex → exact `req_id` match;
  - `errorId:…`, `reqId:…`, `path:…`, `route:…`, `module:…` → that column;
  - anything else → `title LIKE %text%` (FTS5 only if this ever gets slow).
- **Filters:** level, kind, platform, environment, time range (last hour / day / week / all). Kept in the URL query, so
  a filtered view can be bookmarked and the back button works (`hx-push-url`).
- **Auto-refresh** toggle: polls for newer rows every 10 s (`hx-trigger="every 10s"`) and prepends them.
- **Count by day** strip above the list (tiny bar per day, last 14 days) to see a spike at a glance. Optional.

### Detail: `GET /events/{id}`

- Header: title, level, kind, time, environment, platform.
- **Tags** as a table. Each `errorId`, `reqId`, `path`, `route` value links to the list filtered by it ("everything from
  this request").
- **Exception chain:** the thrown error first, then "caused by" each cause. Per frame: function, file, line:col; `in_app`
  frames expanded with their source lines (`pre_context` / `context_line` / `post_context`), library frames collapsed
  ("12 library frames").
- **Timeline** (slow requests): `breakdown` as a line, `spans` in a `<pre>` (keeps the NBSP padding and line breaks).
  Explain `@` = start time from the request's start, as in `docs/backend/logging.md`.
- **Log context** (`contexts.log`): the log message and fields as a key/value table.
- **Browser:** URL, browser, OS, React component stack.
- **Raw JSON**, collapsed, with a copy button.
- **Delete** button (htmx) for one event; "Delete all matching" on the list is optional.

### Look

Plain HTML and one hand-written stylesheet with CSS variables and light/dark via `prefers-color-scheme`. Monospace for
stacks, timelines and IDs. Optionally borrow colors from `docs/frontend/app-identity.md`.

## Security

- **Sign-in:** one admin password from `ADMIN_PASSWORD`. Compare in constant time; on success set a session cookie
  signed with `SESSION_SECRET` (HMAC), `HttpOnly`, `Secure` (except on localhost), `SameSite=Strict`, 7-day expiry.
  Rate-limit login attempts per IP.
- **CSRF:** all state changes are `POST`/`DELETE` from the same origin; `SameSite=Strict` plus an `Origin` check is
  enough.
- **Escaping:** `html/template` escapes everything. Never pass payload values to `template.HTML`, and never put them
  in inline scripts.
- **Headers:** `Content-Security-Policy: default-src 'self'` (htmx is served from the binary, so no inline scripts are
  needed), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- **Public surface:** only `/api/{projectId}/envelope/` (key-checked, size- and rate-limited) and `/healthz`. Everything
  else redirects to `/login`.
- **Data:** what the SDKs send is already scrubbed in the app (`dataCollection`, hidden query parameters). The viewer
  stores it as received.

## Configuration

| Variable         | Default    | Meaning                                                                     |
| ---------------- | ---------- | --------------------------------------------------------------------------- |
| `LISTEN_ADDR`    | `:8000`    |                                                                             |
| `DATA_DIR`       | `/data`    | Where `errors.db` lives                                                     |
| `PROJECT_ID`     | `1`        | The DSN's project ID                                                        |
| `PUBLIC_KEY`     | (required) | The DSN's key; `openssl rand -hex 16`                                       |
| `ADMIN_PASSWORD` | (required) | Dashboard sign-in                                                           |
| `SESSION_SECRET` | (required) | Signs session cookies; `openssl rand -hex 32`                               |
| `ALLOWED_ORIGIN` | (required) | The app's origin, for CORS (`http://localhost:5173`, `https://example.com`) |
| `BASE_URL`       | (required) | The viewer's own URL; used to log the DSN at startup                        |
| `RETENTION_DAYS` | `30`       |                                                                             |
| `MAX_EVENTS`     | `50000`    |                                                                             |

At startup, log the DSN to paste into the app: `<scheme>://<PUBLIC_KEY>@<host>/<PROJECT_ID>`.

## Layout

```text
tools/error-viewer/
  go.mod                 module error-viewer, latest stable Go
  main.go                config, wiring, graceful shutdown (flush the writer on SIGTERM)
  ingest.go              envelope endpoint: auth, CORS, decompression, parsing, rate limit
  envelope.go            envelope parser (pure, unit-tested)
  event.go               event JSON → row columns (title, kind, tags)
  store.go               SQLite: open, migrate, writer goroutine, queries, retention
  web.go                 dashboard handlers, sign-in, sessions
  templates/             layout.html, list.html, rows.html (htmx partial), detail.html, login.html
  static/                htmx.min.js (vendored, pinned version), app.css
  *_test.go              envelope parsing, key rejection, title/kind extraction, dedupe
  Dockerfile             golang:<version> build → gcr.io/distroless/static; `healthcheck` subcommand (no curl in the image)
  README.md              how to run it locally
```

Templates and static files are embedded with `embed.FS`, so the binary is the whole app.

## Changes in This Repo

- **`compose.dev.yaml`:** replace `bugsink` and `bugsink-db` with `error-viewer` (built from `tools/error-viewer`,
  port 8000, fixed dev key and password, volume `error-viewer-data`).
- **`compose.prod.yaml`:** same swap; secrets from `.env`; volume `error-viewer-data`; Caddy depends on it.
- **`deploy/Caddyfile`:** the `{$BUGSINK_DOMAIN}` block becomes `{$ERRORS_DOMAIN}` → `error-viewer:8000`, still passing
  `X-Real-IP`.
- **`.env.example` / `.env.production.example`:** `BUGSINK_*` → `ERRORS_DOMAIN`, `ERROR_VIEWER_PUBLIC_KEY`,
  `ERROR_VIEWER_ADMIN_PASSWORD`, `ERROR_VIEWER_SESSION_SECRET`. `SENTRY_DSN` stays (its value changes).
- **`app/` code:** no behavior change. Update comments that name Bugsink (`error-reporting.server.ts`, `env.server.ts`,
  `entry.client.tsx`) to say "the error viewer".
- **Docs:** `docs/backend/logging.md` (the Bugsink sections become the viewer), `docs/deployment.md` (stack diagram,
  services table, Error Tracking), `README.md`, `CLAUDE.md`. Delete this plan.
- **Checks:** `go vet ./...`, `gofmt -l`, `go test ./...` in `tools/error-viewer`; optionally a lefthook step for Go
  files.
- **Laptop:** the stand-alone Bugsink in `.tmp-claude/bugsink/` can be stopped once the viewer runs; drop its
  `bugsink` database on `postgres_server`.

## Order of Work

1. **Ingest and storage.** Envelope parser with tests, the endpoint, the writer, the schema. Check: point `.env`'s
   `SENTRY_DSN` at it, trigger an error and a slow request, and see rows in `errors.db`.
2. **List and detail pages,** without sign-in yet. Check: search by `errorId`, open a slow request and read its timeline.
3. **Sign-in, security headers, rate limits, retention.**
4. **Docker:** Dockerfile, the compose and Caddy changes, env examples. Check: `docker compose -f compose.dev.yaml up`
   and a browser error from the app arrives.
5. **Docs and cleanup:** remove Bugsink everywhere, update the docs, delete this plan.

## Out of Scope

Grouping into issues, alerts or email, multiple projects or users, source-map upload for browser stacks, receiving
pino logs, metrics. Bugsink (or Sentry) remains the upgrade path if any of these become needed: change `SENTRY_DSN`
back.
