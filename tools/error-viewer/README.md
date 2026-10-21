# Error Viewer

A small Go service that receives the app's error and slow-request reports over Sentry's envelope protocol, stores them
in SQLite and shows them on a dashboard to list, search and inspect. How the app reports to it is in
[docs/backend/logging.md](../../docs/backend/logging.md); how it is deployed, in
[docs/deployment.md](../../docs/deployment.md).

One static binary (`net/http`, `html/template`, htmx, pure-Go SQLite) with its templates and static files embedded.
It has no dependency on the app: its own process, its own database file.

## Running It

In development, `pnpm errors` from the repository root (Go 1.26+): http://localhost:8000, password `admin`, DSN
`http://developmentkey@localhost:8000/1`. It is `go run .` with fixed development settings and `DATA_DIR=./data`, so
there is nothing to build: each start compiles the current source. Restart it after changing the code.

At startup it logs the DSN to put in the app's `SENTRY_DSN`. `PUBLIC_KEY` may hold only letters, digits and `_`: the
Sentry SDKs reject a DSN with any other character in its key and silently send nothing, so the viewer refuses to start
with one.

**Where Google is blocked.** The image is built from Docker Hub only (`golang`, then `scratch`), but the build
downloads Go modules from `proxy.golang.org`. Without access to it, either pass a mirror as the `GOPROXY` build argument
(the compose files read it from `.env`), or run `go mod vendor` here first: the build uses a `vendor/` folder when there
is one, and needs no network for modules. `pnpm errors` downloads them once into Go's module cache; for a mirror there,
run `go env -w GOPROXY=<mirror>,direct` once.

Checks: `go vet ./...`, `gofmt -l .` and `go test ./...` in this folder.

## Configuration

| Variable         | Default    | Meaning                                                                                                   |
| ---------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| `LISTEN_ADDR`    | `:8000`    |                                                                                                           |
| `DATA_DIR`       | `/data`    | Where `errors.db` lives                                                                                   |
| `PROJECT_ID`     | `1`        | The DSN's project ID                                                                                      |
| `PUBLIC_KEY`     | (required) | The DSN's key: letters, digits, `_`; `openssl rand -hex 16`                                               |
| `ADMIN_PASSWORD` | (required) | Dashboard sign-in                                                                                         |
| `SESSION_SECRET` | (required) | Signs session cookies, at least 32 characters; `openssl rand -hex 32`                                     |
| `ALLOWED_ORIGIN` | (required) | The app's origin for CORS, or several separated by commas (`http://localhost:5173,http://localhost:3000`) |
| `BASE_URL`       | (required) | The viewer's own URL. Used for the DSN it logs and for `Secure` cookies                                   |
| `RETENTION_DAYS` | `30`       | Older events are deleted, hourly                                                                          |
| `MAX_EVENTS`     | `50000`    | Only the newest this many events are kept                                                                 |

## How It Works

| File           | Does                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `main.go`      | Configuration, wiring, graceful shutdown, the `healthcheck` subcommand (the image has no curl) |
| `ingest.go`    | `POST /api/{projectId}/envelope/`: key check, CORS, size caps, gzip, rate limits, queueing     |
| `envelope.go`  | The envelope parser                                                                            |
| `event.go`     | Event JSON → row columns: title, kind, level, tags                                             |
| `store.go`     | SQLite: schema, the writer goroutine, list and search queries, retention                       |
| `web.go`       | Dashboard routes, sign-in and sessions, security headers                                       |
| `detail.go`    | The detail page's view of an event                                                             |
| `ratelimit.go` | Token buckets and the client address                                                           |

**Ingest.** The key comes from `X-Sentry-Auth` or the `sentry_key` query parameter (the browser SDK's way) and is
compared in constant time. Bodies are capped at 1 MB on the wire and 8 MB after gzip. Only `event` items are kept;
sessions, client reports and the rest are accepted and dropped. Each client address may send 20 events at once, then
one a second, and everyone together 100 at once, then ten a second. Past that the answer is `429` with `Retry-After`,
which the SDKs honor. Behind Caddy the client address comes from `X-Real-IP`, trusted only from a private or loopback
peer.

**Storage.** One SQLite file (WAL, incremental auto-vacuum). Requests never wait on the disk: events go onto a
buffered queue (1000) that one goroutine writes in batches; a full queue answers `429`. An `event_id` that is already
stored is ignored, since SDKs retry. Each row keeps the columns the list filters on, plus the whole event JSON
(gzipped) that the detail page reads. On `SIGTERM` the server stops taking requests and the queue is flushed.

**Kinds.** `slow` is the app's slow-request report (fingerprint `slow-request`), `error` anything with a real
exception, `message` the rest (`captureMessage` attaches a synthetic exception only to carry a stack). The list shows
browser events (`platform: javascript`) as `browser`.

**Search.** A bare UUID is an `errorId` and 16 hex characters a `reqId` (8 still work, for events stored before the
app's reqIds grew to 64 bits). `errorId:`, `reqId:`, `path:`, `route:`, `module:` and `clientId:` match that column
exactly; anything else is searched in titles. The parsing is `listQuery.filter` in `web.go`.

**Throttled repeats.** The app sends only the first few of a run of alike reports. The next one it sends carries the
count it left out: a slow request's `timeline.skipped`, shown in its Timeline card ("N more slow requests on this route
since the last report"), and an error's `throttle.suppressed`, shown above the event.

**Dashboard.** Every page works without JavaScript: the filters are a GET form, "Load more" is a link, deletes are
POST forms. htmx swaps the results in place, pushes the URL and runs auto-refresh. The CSP is `default-src 'self'`:
htmx's injected indicator styles are turned off in `layout.html` and styled in `app.css`, and the copy buttons and
relative times live in `static/app.js`. Dashboard pages are `no-store`, because the list URL serves both the page and
the htmx fragment.

**Security.** One password; a session is an HMAC-signed expiry in an `HttpOnly`, `SameSite=Strict` cookie (`Secure`
when `BASE_URL` is HTTPS) for seven days. Changing `ADMIN_PASSWORD` or `SESSION_SECRET` signs everyone out. Sign-in
attempts are rate-limited per address. Form posts are checked with Go's `http.CrossOriginProtection`. Event values are
always rendered as escaped text.

**htmx** is vendored in `static/htmx.min.js` (2.0.11). To upgrade, replace the file with another release's
`dist/htmx.min.js`.
