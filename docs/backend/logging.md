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
  runs it from `compose.dev.yaml`, production from `compose.prod.yaml`.
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

A user who sees a 500 gets its `errorId`. Paste it into the error viewer's search box to find the full error, then
click its `reqId` to see everything else that request reported.

**What isn't sent.** Cookies, headers, request bodies, query strings, IP addresses and local variables are all off
(`dataCollection` in both setups). A failed query's parameters are replaced with `(hidden)` unless `LOG_QUERY_PARAMS` is
on.

**Stacks point at source files.** The server bundle ships with source maps and runs with `--enable-source-maps`
(`Dockerfile`), so stacks are mapped before they are logged or sent. The dev server maps them itself. Browser stacks
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
INFO: GET /notes 200 45ms (loader 2×30ms, procedure 1×28ms, db 2×5ms) {"module":"http","reqId":"638455eb"}
```

`loader 2×30ms` means two loaders ran, taking 30 ms in total. A 5xx is an error line. A request slower than
`LOG_SLOW_REQUEST_MS` is a warning line, and is also **reported to the error viewer** as
`Slow request: GET /notes/:id (1420ms)`, of kind `slow`. Search `route:/notes/:id` to see every slow hit on one route.

The report has no stack trace (a stack shows where code is, not where time went). Its **Timeline** block has the time
per kind (`breakdown`) and the request's spans as a tree (`spans`):

```text
  121ms  middleware routes/notes_layout/notes-layout  @1ms
  116ms    db select … from session where session.token = $1  @6ms
 3116ms  loader routes/notes/notes  @123ms
 3116ms    procedure note.list  @123ms
   87ms      db ×5 select … from user where user.id = $1  @124ms
 3024ms      service note.listNotes  @214ms
(3 spans under 65ms not shown)
```

Each line is a span's duration, its kind and name, and `@` when it started, counted from the start of the request:
`3116ms loader … @123ms` began 123 ms into the request and took 3116 ms. Comparing start times shows order and waiting:
a span that starts when the one before it ends ran after it, two that start together ran in parallel, and a gap is time
spent on untraced work. A span is indented under the one it ran inside, so parallel loaders keep their own children.
Identical siblings are merged into one line (`db ×5`) with their total time. Spans under 2% of the request are left out,
and the last line counts them. Queries show their shape only: quotes and column lists are dropped, and parameters are
never included.

Read it from the top down: follow the slowest line at each level. Here the loader waits on `note.list`, which spends
87 ms on queries and 3024 ms in `note.listNotes`, whose own query is too fast to be listed. So the time went into the
service's own code.

- **One span takes most of the time:** that is the bottleneck. For a query, check its plan and indexes.
- **A `×N` line** (`db ×41 select …`): a query inside a loop (N+1). Fetch them in one query or a join.
- **A span much slower than its children:** time in its own code, usually rendering, CPU work or waiting on something
  untraced. Wrap the suspect in a `task` span.
- **`FAILED`:** that span threw. Its error is reported separately with the same `reqId` tag.

A query slower than `LOG_SLOW_QUERY_MS` also gets its own `slow query` warning line, inside or outside a request. It
isn't reported to the error viewer: the slow request it belongs to is.

### Limits

- A request's time ends when its response starts. Content streamed in later (deferred loader data) isn't counted.
- A trace keeps at most 300 spans. Spans past that still count in the totals but not in the timeline, and the timeline
  shows at most 40 lines.
- Only queries through `db` (`app/db/client.server.ts`) are traced. A separate `pg` pool or client isn't.
- The error viewer shows errors, not performance: there are no percentile charts, only reports for requests past the
  threshold. The log lines carry every request's timing.

## The Error Viewer

`tools/error-viewer` receives Sentry envelopes at `/api/1/envelope/`, keeps their `event` items in SQLite and shows
them on a dashboard. It runs as its own container with its own database, so it keeps working when the app or Postgres
is down. Its settings and internals are in [its README](../../tools/error-viewer/README.md).

- **List** (`/`): newest first, with filters for level, kind (`error`, `slow`, `message`, `browser`), platform,
  environment and time, a 14-day count strip and an auto-refresh toggle. Every view is a URL you can bookmark.
- **Search box:** a UUID finds an `errorId`, 8 hex characters a `reqId`; `errorId:`, `reqId:`, `path:`, `route:` and
  `module:` match that field exactly; anything else is searched in titles.
- **Detail** (`/events/<id>`): tags (each `errorId`, `reqId`, `path` and `route` links to the list filtered by it), the
  exception chain with source lines for the app's own frames, the timeline of a slow request, the log line's fields,
  browser details and the raw JSON.

### Development

`pnpm services` starts it with the other services, at http://localhost:8000 (password `admin`). Its key is fixed, so
put `SENTRY_DSN=http://developmentkey@localhost:8000/1` in `.env` and restart `pnpm dev`.

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

At `LOG_LEVEL=warn`, only the slow, failed and erroring requests are written, which suits a busy production server.
`fatal` and `silent` also stop error reports, which are sent from the logger.

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
