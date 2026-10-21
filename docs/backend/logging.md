# Logging, Errors and Performance

How the server logs, where errors and slow requests are reported, and how to find out why a request is slow.

## Overview

```text
request ──▶ entry.server.tsx (trace starts, reqId) ──▶ middleware ▸ loader/action ▸ procedure ▸ service ▸ repository ▸ db
                                                                                                      │
              one log line per request ◀── trace (time per kind + slowest spans) ◀────────────────────┘
              slow request ──▶ error viewer warning, with the timeline of its slowest spans

log.error({ err }) ──▶ log line + error viewer event      browser error ──▶ error viewer event
```

- **Logs are plain pino.** Server code logs through `app/lib/logger.server.ts`, never `console`. Production writes one
  JSON object per line to stdout for Docker to collect. Development prints one line per log through `pino-pretty`.
- **Errors go to the error viewer.** `tools/error-viewer` is a small Go service of this repo that speaks Sentry's
  protocol, so the app uses the official Sentry SDKs (`@sentry/node`, `@sentry/browser`) pointed at it. It stores each
  event with its stack and context in SQLite and lists them for searching. It doesn't group, alert or email. Development
  runs it with `pnpm errors` (`go run`), production from `compose.prod.yaml`.
- **One trace per request.** `app/lib/trace.server.ts` keeps the request's timings in `AsyncLocalStorage`, so a query
  deep inside a service lands in the right request without anything being passed down. Slow requests are reported to
  the error viewer with the trace's timeline.

## Writing Logs

Take a tagged child per module, keep the message short and constant, and put variable details in the object so logs
stay searchable:

```ts
const log = createLogger("media");

log.info({ mediaId, kind }, "media uploaded");
log.error({ err, mediaId }, "could not clean up the variants");
```

- Log errors under the `err` key. pino's standard serializer writes its type, message, stack and cause chain.
- **Every `log.error({ err }, …)` is also reported to the error viewer**, with the line's other fields attached and its
  `module`, `reqId` and `errorId` as searchable tags. There is no separate "report" call: logging the error is
  reporting it. An error-level line without `err` (like `request failed`) is only logged.
- The global oRPC middleware logs every unexpected procedure failure once, with the `errorId` the client receives.
  Don't log and rethrow the same error in services: it would become two reports.
- Every line written while a request is handled carries its `reqId`. Search for it to see everything one request did.
  It is 16 hex characters, and every response returns it as an `X-Request-Id` header (set by the root middleware in
  `app/root.tsx`), so it can be read from the browser's devtools and quoted in a bug report.

## Error Reporting

`app/lib/error-reporting.server.ts` sets up the server SDK; `app/entry.client.tsx` sets up the browser's.

| Source                                                    | How it reaches the error viewer                                |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| Unexpected procedure failures (global oRPC middleware)    | `log.error({ err, errorId })`, tagged with the `errorId`       |
| Loader, action and render errors (`handleError`)          | `log.error({ err })`; ones that already have an `errorId` skip |
| Better-Auth errors, failed health checks, cleanup errors… | Any other `log.error({ err })`                                 |
| Crashes (uncaught exceptions, unhandled rejections)       | The SDK's own handlers                                         |
| Browser errors                                            | The SDK's handlers, plus `onCaughtError` for boundary errors   |
| Slow requests                                             | A warning from the request instrumentation (below)             |

**Repeats are throttled.** Every server report reaches the error viewer from one address, and the viewer's answer to
a burst past its limit makes the SDK stop sending everything for a while. So during an incident the app sends only the
first few of each kind of report (`app/lib/report-throttle.server.ts`):

- **Errors:** at most 5 a minute with the same type, message (digits and UUIDs ignored) and first stack frame in the
  app's own code. Errors that differ in any of these never hold each other back. The next one sent carries how many were
  left out (`throttle.suppressed`), and the viewer shows it above the event.
- **Slow requests:** one report a minute per method and route (see [Reading the Output](#reading-the-output)).

The log line is still written every time: only the report is left out. Up to 500 keys are tracked; past that, the
least recently seen is forgotten.

A user who sees a 500 gets its `errorId`. Paste it into the error viewer's search box to find the full error, then
click its `reqId` to see everything else that request reported.

**Client ID.** Each browser gets a random ID in a `cid` cookie the first time the page runs
(`app/lib/client-id.ts`). Browser reports carry it as a `clientId` tag, and so do the server's reports for that
browser's requests, so one visitor's errors on both sides can be read together. It is random, not a fingerprint of the
device, and identifies nobody: clearing cookies gives a new one. A browser's very first page load has no ID yet,
because the cookie is set once that page runs.

**User ID.** Once a request's session is read (`getRequestSession` in `app/lib/auth.server.ts`, which every session
lookup goes through), its log lines and reports carry the signed-in user's database ID as `userId`. The browser sets
the same tag after hydration, from the site layout's loader, and clears it on sign-out. Only the ID is sent, never the
email or name. It does tie events to a person: the viewer is self-hosted, behind its password, and keeps events for
30 days (`RETENTION_DAYS`), which is the accepted trade-off for finding one user's errors with `userId:`.

**What isn't sent.** Cookies, headers, request bodies, query strings, IP addresses, local variables and the user's
email and name are all off (`dataCollection` in both setups); the user's ID is the one thing set on purpose. A failed
query's parameters are replaced with `(hidden)` unless `LOG_QUERY_PARAMS` is on.

**Secrets are redacted** before a line is written or a report is sent (`app/lib/redact.server.ts`, adapted from
`@nestjs/observe`). The logger redacts a line's fields once, for both its output and the report; the error serializer
and the server SDK's `beforeSend` redact the error's message and stack.

- **By key:** a field whose name ends in `password`, `secret`, `token`, `credential(s)`, `signature`, `jwt`, `cookie`,
  `apiKey`, `privateKey`, `accessKey`, `secretKey`, `sessionId` or `authorization` (`resetToken`, `client_secret`), or
  contains the words `password`, `secret` or `credential` (`passwordConfirm`), or is exactly `pwd` or `auth`, becomes
  `[REDACTED]`, nested objects included. Look-alikes such as `maxTokens` or `author` are kept.
- **In text:** PEM private keys, `Bearer`/`Basic`/`Token` credentials, `key=value` and `"key": "value"` for those keys,
  JWTs, AWS access key IDs and card numbers that pass the Luhn check.
- **In a URL:** the values of those query keys, plus `code`, `state`, `sig` and `key`.

It is a safety net, not a guarantee: a secret logged in a shape none of these match still goes out. Don't log
credentials. Ordinary text, Persian included, is never changed.

**Stacks point at source files.** The server bundle ships with source maps and runs with `--enable-source-maps`
(`Dockerfile`), so stacks are mapped before they are logged or sent. The dev server maps them itself. The image also
ships the server source (`app/`), because the SDK reads each frame's lines from the file it names: without it, reports
would arrive with no source lines. Browser stacks
from a production build are minified, because client source maps aren't published; the message, URL and browser still
show what failed.

**Turning it off.** Without `SENTRY_DSN` nothing is sent, and the app works the same. Tests run that way.

## Request Timing

### What Is Timed

| Kind         | Recorded by                                          | Name                                |
| ------------ | ---------------------------------------------------- | ----------------------------------- |
| `middleware` | React Router instrumentation (`entry.server.tsx`)    | route ID: `routes/notes/...`        |
| `loader`     | React Router instrumentation                         | route ID                            |
| `action`     | React Router instrumentation                         | route ID                            |
| `procedure`  | `traceProcedureMiddleware`, first on the implementer | procedure path: `note.list`         |
| `service`    | `traceLayers` Vite plugin (below)                    | `<feature>.<fn>`: `note.listNotes`  |
| `repository` | `traceLayers` Vite plugin                            | `<feature>.<fn>`: `note.insertNote` |
| `db`         | the traced pool in `app/db/client.server.ts`         | the SQL, without parameters         |
| `storage`    | S3 client middleware in `app/lib/storage.server.ts`  | command: `PutObject`                |
| `task`       | `span(...)` calls in app code                        | whatever the call names             |

Kinds nest: a loader's time includes the procedures it called, and those include their queries. Add the kinds up and
you count the same time more than once.

Procedures are timed the same way over HTTP (`/rpc/*`) and through the server client in a loader.

**Services and repositories** are timed by the `traceLayers` Vite plugin (`vite-plugins/trace-layers.ts`): every
`export async function` in `app/orpc/<feature>/service.ts` or `repository.ts` becomes a span named
`<feature>.<function>`, with no change to the feature's code. Only `async` functions count. A plain function that returns
a Drizzle query (like `findNotesByOwner`) is left alone, because a query builder runs again each time it is awaited;
its query still shows up as a `db` span. Unit tests (`vitest.config.ts`) don't load the plugin.

### Timing Other Work

Wrap anything that may be slow and isn't covered above, such as CPU-heavy processing or a call to an external API:

```ts
import { span } from "~/lib/trace.server";

const processed = await span({ kind: "task", name: "media.processImage" }, () => processImage({ file, kind }));
```

Outside a request (startup, `pnpm db:seed`, tests) `span` just runs the function.

### Reading the Output

Every request writes one line:

```text
INFO: GET /notes 200 45ms (loader 2×30ms, procedure 1×28ms, db 2×5ms) {"module":"http","reqId":"638455eb2c7f1a90"}
```

`loader 2×30ms` means two loaders ran, taking 30 ms in total. A 5xx is an error line. A request slower than
`LOG_SLOW_REQUEST_MS` is a warning line, and is also **reported to the error viewer** as
`Slow request: GET /notes/:id (1420ms)`, of kind `slow`. Search `route:/notes/:id` to see the slow hits on one route.
Only one report per method and route is sent a minute, so a slow database doesn't flood the viewer and crowd out the
errors. The next report carries how many were left out (`timeline.skipped`), shown as "N more slow requests on this
route since the last report". The warning line is written for every one.

The report has no stack trace (a stack shows where code is, not where time went). Its **Timeline** shows the time per
kind and draws the request's spans as a waterfall, one row each:

```text
Span                                          Start  Duration  0        1s        2s        3s
middleware routes/notes_layout/notes-layout     1ms     121ms  ▇
  db select … from session where …              6ms     116ms  ▇
loader routes/notes/notes                     123ms    3116ms   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
  procedure note.list                         123ms    3116ms   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
    db ×5 select … from user where …          124ms      87ms   ▇
    service note.listNotes                    214ms    3024ms    ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
3 spans under 65ms not shown.
```

Each row is a span's kind and name, when it started (counted from the start of the request) and how long it took; its
bar shows the same on the request's time axis. The bars show order and waiting: a span that starts when the one before
it ends ran after it, two that start together ran in parallel, and a gap is time spent on untraced work. A span is
indented under the one it ran inside, so parallel loaders keep their own children. Identical siblings are merged into one
row (`db ×5`) with their total time. Spans under 2% of the request are left out, and the line under the table counts
them. Queries show their shape only: quotes and column lists are dropped, and parameters are never included. The app
sends the rows as data (`traceTimeline` in `app/lib/trace.server.ts`); the viewer draws them.

Read it from the top down: follow the longest bar at each level. Here the loader waits on `note.list`, which spends
87 ms on queries and 3024 ms in `note.listNotes`, whose own query is too fast to be listed. So the time went into the
service's own code.

- **One span takes most of the time:** that is the bottleneck. For a query, check its plan and indexes.
- **A `×N` row** (`db ×41 select …`): a query inside a loop (N+1). Fetch them in one query or a join.
- **A span much slower than its children:** time in its own code, usually rendering, CPU work or waiting on something
  untraced. Wrap the suspect in a `task` span.
- **`failed`:** that span threw (its bar is red). Its error is reported separately with the same `reqId` tag.

A query slower than `LOG_SLOW_QUERY_MS` also gets its own `slow query` warning line, inside or outside a request. It
isn't reported to the error viewer: the slow request it belongs to is.

### Limits

- A request's time ends when its response starts. Content streamed in later (deferred loader data) isn't counted.
- A trace keeps at most 300 spans. Spans past that still count in the totals but not in the timeline, and the timeline
  shows at most 40 rows.
- Only queries through `db` (`app/db/client.server.ts`) are traced. A separate `pg` pool or client isn't.
- The error viewer shows errors, not performance: there are no percentile charts, only reports for requests past the
  threshold. The log lines carry every request's timing.

## The Error Viewer

`tools/error-viewer` receives Sentry envelopes at `/api/1/envelope/`, keeps their `event` items in SQLite and shows
them on a dashboard. It runs as its own process with its own database, so it keeps working when the app or Postgres
is down. Its settings and internals are in [its README](../../tools/error-viewer/README.md).

- **List** (`/`): newest first, with filters for level, kind (`error`, `slow`, `message`, `browser`), platform,
  environment and time, a 14-day count strip and an auto-refresh toggle. Every view is a URL you can bookmark.
  Consecutive events with the same `clientId` are drawn as one card, with the client and its event count on the first
  row. Only neighbors group: a client whose events are interleaved with another's shows as separate cards.
- **Search box:** a UUID finds an `errorId`, 16 hex characters a `reqId` (8 for events stored before reqIds grew);
  `errorId:`, `reqId:`, `path:`, `route:`, `module:`, `clientId:` and `userId:` match that field exactly; anything
  else is searched in titles.
- **Detail** (`/events/<id>`): tags (each `errorId`, `reqId`, `path`, `route`, `clientId` and `userId` links to the
  list filtered by it), the exception chain with source lines for the app's own frames, the timeline of a slow
  request, the log line's fields, browser details and the raw JSON.

### Development

`pnpm errors` runs it next to `pnpm dev`, at http://localhost:8000 (password `admin`). It needs Go 1.26+ and no build
step: `go run` compiles the current source on each start (cached, so a restart takes a moment), so restart it after
changing the viewer's code. Events are kept in `tools/error-viewer/data/` (gitignored). Its key is fixed, so put
`SENTRY_DSN=http://developmentkey@localhost:8000/1` in `.env` and restart `pnpm dev`.

`.env.example` sets `LOG_LEVEL=warn`, so the dev terminal shows only warnings and errors, and the viewer holds their
details. Set `LOG_LEVEL=info` to see every request line again.

### Production

`compose.prod.yaml` runs it on its own subdomain (`ERRORS_DOMAIN`), behind Caddy. The setup is in
[deployment.md](../deployment.md) → Error Tracking.

### Another Tracker

The app only speaks Sentry's protocol, so Bugsink or Sentry itself work as a drop-in: point `SENTRY_DSN` at one of their
projects. Do that when you need what the viewer leaves out: grouping into issues, alerts, several projects or users.

## Configuration

| Variable              | Default | Meaning                                                         |
| --------------------- | ------- | --------------------------------------------------------------- |
| `LOG_LEVEL`           | `info`  | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`    |
| `LOG_SLOW_REQUEST_MS` | `1000`  | A request at least this slow is a warning and an error report   |
| `LOG_SLOW_QUERY_MS`   | `200`   | A query at least this slow is logged on its own                 |
| `LOG_QUERY_PARAMS`    | `false` | Log and report a failed query's parameters (personal data risk) |
| `SENTRY_DSN`          | (empty) | The error viewer's DSN, for the server and the browser          |

`.env.example` turns `LOG_QUERY_PARAMS` on, since development data is your own and the values help debugging.
Production leaves it off unless you set it.

At `LOG_LEVEL=warn`, only the slow, failed and erroring requests are written, which suits development next to the
error viewer and a busy production server. `fatal` and `silent` also stop error reports, which are sent from the logger.

The browser bundle reads `SENTRY_DSN` when it is built (`envPrefix` in `vite.config.ts`), so changing it needs a
rebuild. The server reads it at startup.

## Production Logs

- Each line is one JSON object. The request line has `request.{method,path,status,ms}`, `request.route` (the matched
  pattern, e.g. `/notes/:id`, for grouping) and `request.timing.<kind>.{count,ms}`.
- Paths are logged without their query string, which can carry tokens.
- A healthy `/healthz` probe writes no request line, because Docker and uptime monitors poll it every few seconds. A
  slow or failing probe is logged like any other request.
- `react-router-serve` also writes its own plain-text access line for each request. Moving to a custom Express server
  would remove it.
