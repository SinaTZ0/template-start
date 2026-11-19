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
there is nothing to build: each start compiles the current source. Restart it after changing the code. It looks for
source maps at `http://localhost:3000`, where `pnpm build && pnpm start` serves the app; the dev server's stacks need
none.

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

| Variable           | Default    | Meaning                                                                                                   |
| ------------------ | ---------- | --------------------------------------------------------------------------------------------------------- |
| `LISTEN_ADDR`      | `:8000`    |                                                                                                           |
| `DATA_DIR`         | `/data`    | Where `errors.db` lives                                                                                   |
| `PROJECT_ID`       | `1`        | The DSN's project ID                                                                                      |
| `PUBLIC_KEY`       | (required) | The DSN's key: letters, digits, `_`; `openssl rand -hex 16`                                               |
| `ADMIN_PASSWORD`   | (required) | Dashboard sign-in                                                                                         |
| `SESSION_SECRET`   | (required) | Signs session cookies, at least 32 characters; `openssl rand -hex 32`                                     |
| `ALLOWED_ORIGIN`   | (required) | The app's origin for CORS, or several separated by commas (`http://localhost:5173,http://localhost:3000`) |
| `BASE_URL`         | (required) | The viewer's own URL. Used for the DSN it logs and for `Secure` cookies                                   |
| `RETENTION_DAYS`   | `30`       | Older events are deleted, hourly                                                                          |
| `MAX_EVENTS`       | `50000`    | Only the newest this many events are kept                                                                 |
| `MAX_DB_MB`        | `1024`     | The most the database may hold, in MB; the oldest events are deleted past it                              |
| `SOURCEMAP_ORIGIN` | (none)     | Where the app serves its client source maps (`http://app:3000`); without it browser stacks stay minified  |
| `NOTIFY_URL`       | (none)     | A chat webhook that hears of each new kind of error                                                       |
| `NOTIFY_CHAT_ID`   | (none)     | Sent as `chat_id` with each message, for a bot API in Telegram's style                                    |
| `TRACE_URL`        | (none)     | A request's trace in the tracing backend, `{traceId}` where its ID goes; adds "Open trace" to a `reqId`   |

## How It Works

| File           | Does                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `main.go`      | Configuration, wiring, graceful shutdown, the `healthcheck` subcommand (the image has no curl) |
| `ingest.go`    | `POST /api/{projectId}/envelope/`: key check, CORS, size caps, gzip, rate limits, queueing     |
| `envelope.go`  | The envelope parser                                                                            |
| `event.go`     | Event JSON → row columns: title, kind, level, tags                                             |
| `store.go`     | SQLite: schema, the writer goroutine, list, group and search queries, retention                |
| `sourcemap.go` | Source maps: the decoder, and mapping a browser event's frames when it arrives                 |
| `notify.go`    | The message to a chat webhook for a new kind of error                                          |
| `web.go`       | Dashboard routes, sign-in and sessions, security headers                                       |
| `detail.go`    | The detail page's view of an event                                                             |
| `hidden.go`    | Finds hidden and look-alike characters in a value, for the detail page                         |
| `ratelimit.go` | Token buckets and the client address                                                           |

**Ingest.** The key comes from `X-Sentry-Auth` or the `sentry_key` query parameter (the browser SDK's way) and is
compared in constant time. Bodies are capped at 1 MB on the wire and 8 MB after gzip. Only `event` items are kept;
sessions, client reports and the rest are accepted and dropped. Each client address may send 20 events at once, then
one a second, and everyone together 100 at once, then ten a second. Requests are counted too, before the body is
read: 120 at once per address, then four a second, whatever they carry. Past a limit the answer is `429` with
`Retry-After`, which the SDKs honor. Behind Caddy the client address comes from `X-Real-IP`, trusted only from a
private or loopback peer. An IPv6 address counts as its /64, since one subscriber holds all of it.

**Size.** The key is public (every browser has it), so what one event and all events together may take is capped. An
event over 256 KB of JSON loses its largest top-level fields until it fits; the detail page says which. Its columns
are read before that, so search still finds it. Retention deletes by age and count, and then the oldest events until
the database is under `MAX_DB_MB`. It runs hourly, and again after every 32 MB the writer stores, so a flood can't
outgrow the cap between two runs.

**Storage.** One SQLite file (WAL, incremental auto-vacuum). Requests never wait on the disk: events go onto a
buffered queue (1000) that one goroutine writes in batches; a full queue answers `429`. An `event_id` that is already
stored is ignored, since SDKs retry. A batch that fails is tried again, then row by row, so one row SQLite refuses
loses only itself. Each row keeps the columns the list filters on, plus the event JSON (gzipped) that the detail page
reads. On `SIGTERM` the server stops taking requests and the queue is flushed.

**Kinds.** `slow` is the app's slow-request report (fingerprint `slow-request`), `error` anything with a real
exception, `message` the rest (`captureMessage` attaches a synthetic exception only to carry a stack). The list shows
browser events (`platform: javascript`) as `browser`.

**Search.** A bare UUID is an `errorId` and 32 hex characters a `reqId`: the app's request IDs are its requests'
trace IDs (16 and 8 still work, for events stored before). `errorId:`, `reqId:`, `path:`, `route:`, `module:`,
`clientId:`, `userId:`, `release:` and `group:` match that column exactly (`userId:` and `release:` as typed); anything else is searched in titles. The
user ID is the server's `userId` tag or the browser SDK's `user.id`. The parsing is `listQuery.filter` in `web.go`.

**Groups.** "Group alike" shows one row per kind of event: its newest event, how many are stored and when the first
came. A row leads to the list of its events. Events are alike when they have the same group key (`groupKey` in
`event.go`), set when the event arrives: a slow request's method and route; an error's type, its message without
numbers and IDs, and the innermost frame of the app's own code; a message's level and text. Events stored before
groups existed each form their own. The detail page links to the other events of its group.

**Source maps.** With `SOURCEMAP_ORIGIN`, a browser event's frames are mapped when it arrives (`sourcemap.go`): for a
frame in `/assets/x.js` the viewer fetches `/assets/x.js.map` from the app, and the frame gets its source file, line
and column, the lines around it, and the name of the function it was called as. Code from `node_modules` folds away as
library frames. The minified position stays in the frame's `data.minified`. Mapping at arrival is what keeps old
events readable: a deploy replaces the built files and their maps. The viewer asks the app only for paths that end in
`.js.map`, whatever a frame says, keeps the 24 maps used last in memory, and retries a missing one after a minute.

**Notifications.** With `NOTIFY_URL`, an error (level `error` or `fatal`) whose group has no stored event in the last
six hours is announced: one `POST` of `{"text": "…"}` with the environment, title, kind, path, release and the event's
link, plus `chat_id` when `NOTIFY_CHAT_ID` is set. At most five at once, then one a minute; the next message says how
many were held back. A kind of error that keeps failing is announced once.

**Throttled repeats.** The app sends only the first few of a run of alike reports. The next one it sends carries the
count it left out: a slow request's `timeline.skipped`, shown in its Timeline card ("N more slow requests on this route
since the last report"), and an error's `throttle.suppressed`, shown above the event.

**Dashboard.** Every page works without JavaScript: the filters are a GET form, "Load more" is a link, deletes are
POST forms. htmx swaps the results in place, pushes the URL and runs auto-refresh. Times are rendered in UTC and
shown in the reader's time zone by `app.js`, which also tells the server the zone's offset in a `tz` cookie, so the
14-day strip counts the reader's days. Beside the exception, the detail page shows the event's user, extra data and
breadcrumbs (what the SDK noted before the error: clicks, navigations, requests, console lines). The CSP is `default-src 'self'`:
htmx's injected indicator styles are turned off in `layout.html` and styled in `app.css`, and the copy buttons and
relative times live in `static/app.js`. Dashboard pages are `no-store`, because the list URL serves both the page and
the htmx fragment.

**Hidden characters.** On the detail page, a value that holds a character which looks like Persian but isn't, or
doesn't show at all, is shown a second time under itself with each such character as a marker:
`عل[ي U+064A Arabic yeh]`. Hovering a marker says what Persian uses instead. It covers the exception messages, the event message, tags,
the request and the log line's fields. Flagged: Arabic yeh, alef maksura and kaf (U+064A, U+0649, U+0643), tatweel,
ZWNJ and ZWJ, direction marks, embeddings, overrides and isolates, NBSP, the BOM, Arabic-Indic digits, and Latin digits
in text that also has Persian ones. The markers are built in Go (`hidden.go`) and rendered as escaped text like every
other value; a value with none of these renders as before.

**Security.** One password; a session is an HMAC-signed expiry in an `HttpOnly`, `SameSite=Strict` cookie (`Secure`
when `BASE_URL` is HTTPS) for seven days. The signature also covers a counter kept in the database, which "Sign out"
raises: that ends every session, a copied cookie's included. Changing `ADMIN_PASSWORD` or `SESSION_SECRET` does the
same. Sign-in attempts are limited per address (ten, then five a minute), and wrong passwords from all addresses
together (forty, then twenty a minute): while a flood of guesses uses that up, a right password is refused too, so
pick a long random one and the limit never matters. Form posts are checked with Go's `http.CrossOriginProtection`.
The redirect after sign-in only goes to a path on the viewer. Event values are always rendered as escaped text.

**htmx** is vendored in `static/htmx.min.js` (2.0.11). To upgrade, replace the file with another release's
`dist/htmx.min.js`.
