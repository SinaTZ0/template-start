# Logging, Errors and Performance

How the server logs, where errors and slow requests are reported, and how to find out why a request is slow.

## Overview

```text
request ──▶ src/server.ts ▸ observeRequest (root span) ──▶ rpc.<path> ▸ service ▸ repository ▸ db
                                                                                               │
          one log line per request ◀── request collector (time per kind + the request's spans) ◀┘
          slow request ──▶ error viewer warning, with the timeline of its spans

Effect.logError(…, cause) / log.error({ err }) ──▶ log line + error viewer event
browser error ──▶ error viewer event
spans, log lines, metrics ──▶ OTLP backend (OpenObserve), only when OTEL_EXPORTER_OTLP_ENDPOINT is set
```

The code is in `src/server/observability/`.

- **One writer.** Every line the server writes goes through `writeLog` (`log.server.ts`): Effect's log entries
  through the app's logger (`logger.server.ts`), and the few places outside any fiber through `createLogger`.
  Production writes one JSON object per line to stdout for Docker to collect. Development prints one readable line
  per entry, with an error under it. With the OTLP export on, the same lines also go to the backend.
- **Errors go to the error viewer.** `tools/error-viewer` is a small Go service of this repo that speaks Sentry's
  protocol, so the app uses the official Sentry SDKs (`@sentry/node`, `@sentry/browser`) pointed at it. It stores each
  event with its stack and context in SQLite and lists them for searching. Development runs it with `pnpm errors`
  (`go run`), production from `compose.prod.yaml`.
- **One trace per request.** The server entry opens a root span per request (`observeRequest` in `http.server.ts`),
  and every Effect the request starts joins it, the procedures that loaders call in-process included. Its trace ID is
  the request's ID. A tracer wrapper (`request-spans.server.ts`) keeps each request's spans for its log line and, when
  it was slow, a report to the error viewer with the spans' timeline.

## Writing Logs

Effect code logs with `Effect.logDebug`, `Effect.logInfo`, `Effect.logWarning` and `Effect.logError`. Keep the message
short and constant, and put variable details in annotations so logs stay searchable:

<!-- prettier-ignore -->
```ts
yield* Effect.logInfo("deleted orphaned media").pipe(Effect.annotateLogs({ deleted, failed }));
```

- Log an error as the cause, after the message: `Effect.logError("could not clean up the variants", cause)` in an
  `Effect.catchCause`. A typed error is logged as `Cause.fail(error)` (`mail.send` does it for a refused email). The
  line gets the error under `err`, with its type, message, stack and cause chain.
- **Every error-level line with an error is also reported to the error viewer**, with the line's other fields
  attached and its `module`, `reqId`, `userId`, `clientId` and `errorId` as searchable tags. There is no separate
  "report" call: logging the error is reporting it. An error-level line without one (like `request failed`) is only
  logged.
- The `module` annotation names the line's module (`Effect.annotateLogs({ module: "media" })`); without one it is
  `app`. A procedure's lines are `orpc`, a job's `jobs`. Every other annotation becomes a field of the line.
- The boundary logs every defect of a procedure once, with the `errorId` the client receives. Don't log a failure and
  then fail with it in services: it would become two reports.

Code that runs outside Effect (Better-Auth's callbacks, the oRPC handler's interceptor, `handleErrorsMiddleware`) takes
a logger per module, with the error under `err`:

```ts
const log = createLogger("auth");

created.on("error", (error) => log.error({ err: error }, "idle auth database connection failed"));
```

Never use `console` in server code; seeds and scripts are the exception.

**Request IDs.** A request's ID is its trace ID (32 hex characters), under one name per place:

- **`trace_id`** in every line written while the request is handled, with the `span_id` it was written in. These are
  OpenTelemetry's names, which log collectors match a line to its trace by. Search the logs for the ID to see
  everything one request did.
- **`X-Request-Id`** on every response (`observeRequest`), so it can be read from the browser's devtools and quoted in a
  bug report.
- **`reqId`** on the request's reports in the error viewer.

Each job run is a trace of its own, so its lines share a `trace_id` too.

## Error Reporting

`report.server.ts` sets up the server SDK; `src/client.tsx` sets up the browser's.

| Source                                                 | How it reaches the error viewer                            |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| Defects in procedures (`effectProcedure`)              | `procedure failed`, tagged with the client's `errorId`     |
| Other oRPC failures (an output off its schema)         | `handleErrorsMiddleware`, the same way                     |
| Failures of the request handler itself                 | `unhandled request error`, from `observeRequest`           |
| Failed jobs, Better-Auth errors, failed health checks… | Any other error line with an error                         |
| Crashes (uncaught exceptions, unhandled rejections)    | The SDK's own handlers                                     |
| Browser errors                                         | The SDK's handlers, and `onCaughtError` for boundaries     |
| Slow requests                                          | A warning from `observeRequest` (Reading the Output below) |

**Repeats are throttled.** Every server report reaches the error viewer from one address, and the viewer's answer to
a burst past its limit makes the SDK stop sending everything for a while. So during an incident the app sends only the
first few of each kind of report (`src/lib/report-throttle.server.ts`):

- **Errors:** at most 5 a minute with the same type, message (digits and UUIDs ignored) and first stack frame in the
  app's own code. Errors that differ in any of these never hold each other back. The next one sent carries how many were
  left out (`throttle.suppressed`), and the viewer shows it above the event.
- **Slow requests:** one report a minute per method and route.

The log line is still written every time: only the report is left out. Up to 500 keys are tracked; past that, the
oldest is forgotten.

A user who sees a 500 gets its `errorId`. Paste it into the error viewer's search box to find the full error, then
click its `reqId` to see everything else that request reported.

### Client ID

Each browser gets a random ID in a `cid` cookie the first time the page runs (`src/lib/client-id.ts`). Browser
reports carry it as a `clientId` tag, and so do the server's reports for that browser's requests, so one
visitor's errors on both sides can be read together. It is random, not a fingerprint of the device, and identifies
nobody: clearing cookies gives a new one. A browser's very first page load has no ID yet, because the cookie is set
once that page runs.

### User ID

Once a procedure with `access` has found the signed-in user, the rest of the request's lines and reports carry the
user's database ID as a `userId` tag: `effectProcedure` puts it on the request scope, on the procedure's log lines and
on its span (`user.id`). A request that runs no such procedure has none. The browser sends the same ID as the report's
user (`setReportedUser`, called after hydration from the viewer query in `src/routes/site_layout/`, and cleared on
sign-out). The error viewer reads both, so `userId:` finds a user's server and browser events alike. Only the ID is
sent, never the email or name. It does tie events to a person: the viewer is self-hosted, behind its password, and
keeps events for 30 days (`RETENTION_DAYS`), which is the accepted trade-off for finding one user's errors with
`userId:`.

### What Isn't Sent

Cookies, headers, request bodies, query strings, IP addresses, local variables and the user's email and name are all
off (`dataCollection` in both setups); the user's ID is the one thing set on purpose. A failed query's parameters are
replaced with `(hidden)` unless `LOG_QUERY_PARAMS` is on; Drizzle leaves them out of its errors entirely unless it is.

**Secrets are redacted** before a line is written, a report is sent or a span is exported
(`src/lib/redact.server.ts`, adapted from `@nestjs/observe`). `writeLog` redacts a line's message and fields once, for
its output, its report and its export; the error serializer and the server SDK's `beforeSend` redact the error's
message and stack; and the tracer redacts the error a failed span is exported with (`request-spans.server.ts`).

- **By key:** a field whose name ends in `password`, `secret`, `token`, `credential(s)`, `signature`, `jwt`, `cookie`,
  `apiKey`, `privateKey`, `accessKey`, `secretKey`, `sessionId` or `authorization` (`resetToken`, `client_secret`), or
  contains the words `password`, `secret` or `credential` (`passwordConfirm`), or is exactly `pwd` or `auth`, becomes
  `[REDACTED]`, nested objects included. Look-alikes such as `maxTokens` or `author` are kept.
- **In text:** PEM private keys, `Bearer`/`Basic`/`Token` credentials, `key=value` and `"key": "value"` for those keys,
  JWTs, AWS access key IDs and card numbers that pass the Luhn check.
- **In a URL:** the values of those query keys, plus `code`, `state`, `sig` and `key`.

It is a safety net, not a guarantee: a secret logged in a shape none of these match still goes out. Don't log
credentials. Settings that are secrets are `Redacted` in `AppConfig`, so they print as `<redacted>` wherever they end
up. Ordinary text, Persian included, is never changed.

### Release and Source Maps

**Release.** A production build carries the commit it was made from (`APP_RELEASE`, read in `vite.config.ts`: the
deploy tool passes it to the image build, and a build on your machine asks git). Both SDKs send it as the report's
release, and the OTLP export as the service version; the viewer shows it and finds a build's events with
`release:<commit>`. The dev server sends none.

**Stacks point at source files.** The server bundle ships with source maps and runs with `--enable-source-maps`
(`Dockerfile`), so stacks are mapped before they are logged or sent. The dev server maps them itself. The image also
ships the server source (`src/`), because the SDK reads each frame's lines from the file it names: without it, reports
would arrive with no source lines.

Browser stacks from a production build are minified. The build writes the client's source maps next to the built files
without linking to them (`sourcemap: "hidden"` in `vite.config.ts`), and the error viewer fetches the map for each
frame from the app when the event arrives, then stores the event with source files, lines and the code around them
(`tools/error-viewer/README.md` → Source maps). The maps hold the source, so in production Caddy refuses `*.map` to
the outside; the viewer reaches the app inside the stack. An error from a tab still running the previous build, sent
after a deploy replaced that build's files, stays minified.

**Turning it off.** Without `SENTRY_DSN` nothing is sent, and the app works the same. Tests run that way.

## Request Timing

### What Is Timed

Every span is sorted into a kind by its name (`spanKind` in `timeline.ts`), so the naming convention of `Effect.fn` is
what makes the timing work:

| Kind         | Spans                                                       | Example                              |
| ------------ | ----------------------------------------------------------- | ------------------------------------ |
| `procedure`  | `effectProcedure`'s span, `rpc.<path>`                      | `rpc.note.list`                      |
| `service`    | Names that start with `<Name>Service.`                      | `NoteService.list`                   |
| `repository` | Names that start with `<Name>Repo.`                         | `NoteRepo.findOwned`                 |
| `db`         | Each statement on the app's pool: Drizzle's and the queue's | the SQL, without parameters          |
| `storage`    | Names that start with `Storage.`                            | `Storage.put`                        |
| `task`       | Every other span                                            | `Auth.session`, `media.processImage` |

The request itself is the root span, of kind `server`, named for its method and route: `GET /notes/$noteId` (the
route pattern) for a page, `POST /rpc/note/list` (the procedure's path) for a call from the browser. A path that
matches nothing falls to a catch-all route (`/$`, `/rpc/$`), so the routes are only ever the app's own. Kinds nest: a
procedure's time includes its service and repository calls, and those include their queries. Add the kinds up and you
count the same time more than once.

Procedures are timed the same way over HTTP (`/rpc/*`) and in-process, when a loader calls them during SSR: both are
children of the request's root span, which the boundary finds through the request scope (`request-scope.server.ts`,
read outside the fiber only). Every other boundary that runs an Effect during a request joins it the same way
(`joinRequest`): the server routes outside oRPC, through `runInRequest`, and Better-Auth's callbacks, so a sign-up's
captcha check and the email it queues are part of the sign-up's request. Loaders, `beforeLoad` and rendering aren't spans of their own: they run in the browser
too, and the server-side work they start is already a `procedure` span. Time spent rendering shows as the gap between
those spans and the end of the request.

Better-Auth's queries run on its own pool, which isn't traced: their time is the `Auth.session` span's, and the
`Auth.handle` span's for an `/api/auth/*` request.

### Timing Other Work

A function written as `Effect.fn("Owner.method")` is already a span. Wrap anything else that may be slow, such as
CPU-heavy processing or a call to an external API, in `Effect.withSpan`:

<!-- prettier-ignore -->
```ts
const processed = yield* Effect.promise(() => processImage({ file, kind })).pipe(
  Effect.withSpan("media.processImage"),
);
```

Outside a request (startup, a job, `pnpm db:seed`, tests) spans are still made and exported, but no request line
collects them.

### Reading the Output

Every request writes one line, here as development prints it:

```text
[09:41:07.215] INFO: GET /notes 200 45ms (task 2×9ms, service 2×30ms, procedure 2×36ms, db 1×9ms, repository 1×12ms)
```

followed by its fields: `module`, `trace_id`, `span_id`, `userId` when known, and the request's method, path, status
and route under the names its span uses (`http.request.method`, `url.path`, `http.response.status_code`, `http.route`),
with its time as `duration_ms`. `procedure 2×36ms` means two procedures ran, taking 36 ms in total; kinds are listed in the order their first
span ended. A 5xx is an error line (`request failed: …`). A request slower than `LOG_SLOW_REQUEST_MS` is a warning
line (`slow request: …`), and is also **reported to the error viewer** as `Slow request: GET /notes/$noteId (1420ms)`,
of kind `slow`. Search `route:/notes/$noteId` to see the slow hits on one route. Only one report per method and route
is sent a minute, so a slow database doesn't flood the viewer and crowd out the errors. The next report carries how
many were left out (`timeline.skipped`), shown as "N more slow requests on this route since the last report". The
warning line is written for every one.

The report has no stack trace (a stack shows where code is, not where time went). Its **Timeline** shows the time per
kind and draws the request's spans as a waterfall, one row each:

```text
Span                                          Start  Duration  0        1s        2s        3s
procedure rpc.session.viewer                    1ms     121ms  ▇
  service SessionService.viewer                 2ms     119ms  ▇
    task Auth.session                           2ms     118ms  ▇
procedure rpc.note.list                       123ms    3116ms   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
  task Auth.session                           124ms      87ms   ▇
  service NoteService.list                    214ms    3024ms    ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
3 spans under 65ms not shown.
```

Each row is a span's kind and name, when it started (counted from the start of the request) and how long it took; its
bar shows the same on the request's time axis. The bars show order and waiting: a span that starts when the one before
it ends ran after it, two that start together ran in parallel, and a gap is time spent on untraced work. A span is
indented under the one it ran inside, so parallel work keeps its own children. Identical siblings are merged into one
row (`db ×5`) with their total time. Spans under 2% of the request are left out, and the line under the table counts
them. Queries show their shape only: quotes and column lists are dropped (`sql-text.ts`), and parameters are never
included. The app sends the rows as data (`buildTimeline` in `timeline.ts`); the viewer draws them.

Read it from the top down: follow the longest bar at each level. Here the page waits on `rpc.note.list`, which spends
87 ms reading the session and 3024 ms in `NoteService.list`, whose own query is too fast to be listed. So the time went
into the service's own code.

- **One span takes most of the time:** that is the bottleneck. For a query, check its plan and indexes.
- **A `×N` row** (`db ×41 select …`): a query inside a loop (N+1). Fetch them in one query or a join.
- **A span much slower than its children:** time in its own code, usually rendering, CPU work or waiting on something
  untraced. Wrap the suspect in `Effect.withSpan`.
- **`failed`:** that span ended with a defect (its bar is red). Its error is reported separately with the same `reqId`
  tag. A typed failure (`NoteNotFound`) is an expected outcome, not a failed span.

A query slower than `LOG_SLOW_QUERY_MS` also gets its own `slow query` warning line (module `db`, with `sql` and `ms`),
inside or outside a request. It isn't reported to the error viewer: the slow request it belongs to is.

### Limits

- A request's time ends when its response starts. Content streamed in later (the rest of a streamed page) isn't
  counted.
- A request keeps at most 300 spans. Spans past that still count in the totals but not in the timeline, and the
  timeline shows at most 40 rows.
- Only statements on the app's pool (`PgLive`) are `db` spans. A separate `pg` pool or client, like Better-Auth's,
  isn't traced.
- The error viewer shows errors, not performance: there are no percentile charts, only reports for requests past the
  threshold. The log lines carry every request's timing, and the OTLP export every request's trace and the metrics
  to chart percentiles from.

## OpenTelemetry

With `OTEL_EXPORTER_OTLP_ENDPOINT` set, the app sends its traces, metrics and logs to an OpenTelemetry backend over
OTLP/HTTP (`export.server.ts`). Without it, nothing leaves the server. The settings are OpenTelemetry's own
variables, and the names of spans, attributes and metrics are its
[semantic conventions](https://opentelemetry.io/docs/specs/semconv/) wherever one exists, so any OTLP backend can be
set up from its own instructions and its ready-made views read the data.

### Traces

The same spans the request line is made from: one trace per request, with its procedures, services, repositories,
queries and bucket calls, and one per job run. The exporter's tracer sits under the request collector, so the request
line and the slow-request timeline keep working.

| Span              | Kind       | Name                 | Attributes                                                                                                         |
| ----------------- | ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A request         | `server`   | `GET /notes/$noteId` | `http.request.method`, `http.route`, `url.path`, `url.scheme`, `http.response.status_code`; `error.type` for a 5xx |
| A procedure       | `internal` | `rpc.note.list`      | `user.id` once the session is read                                                                                 |
| A service, a repo | `internal` | `NoteService.list`   | What the code adds with `Effect.annotateCurrentSpan`                                                               |
| A statement       | `client`   | The database's name  | `db.system.name`, `db.namespace`, `db.query.text` (never its parameters), `db.operation.name`, `server.address`    |
| A job run         | `consumer` | `job media.discard`  | `job.name`, `job.id`, `job.attempt`                                                                                |

**What counts as failed.** A span is exported as an error only when something went wrong:

- A span that ends with a defect (a failed query, a bug) is an error, with the exception as its event, its message
  and stack redacted like a log line's.
- A span that ends with a typed failure (`NoteNotFound`, `Unauthorized`, `RateLimited`) is not: that is an expected
  outcome, and a signed-out visitor would otherwise fill the backend's error list. The span names the failure in
  `app.outcome` instead.
- The request's span is an error when the response is a 5xx, as the conventions ask of a server, and a job run's span
  when the run fails in any way.
- A typed failure the client gets a 5xx for is an error after all (a case that maps it to `SERVICE_UNAVAILABLE`).
  `effectProcedure` names it on the call's span (`error.type`, the error's tag), and a span that names an error is
  exported as one. The failure is also logged at `error`, so it is reported.

The trace context a request arrives with (`traceparent`) is not read: the app is the first hop behind Caddy, and a
header anyone can send must not pick the trace a request joins.

### Metrics

Defined in `metrics.server.ts`, exported every 10 seconds. Durations are in seconds.

| Metric                         | Kind      | Attributes                                                       |
| ------------------------------ | --------- | ---------------------------------------------------------------- |
| `http.server.request.duration` | histogram | `http.request.method`, `http.route`, `http.response.status_code` |
| `db.client.operation.duration` | histogram | `db.system.name`, `db.operation.name` (`SELECT`, `INSERT`…)      |
| `job.run.duration`             | histogram | `job.name`, `job.outcome` (`success`, `retry`, `failed`)         |
| `process.memory.usage`         | gauge     | The resident memory, in bytes                                    |
| `v8js.memory.heap.used`        | gauge     | The heap in use, in bytes                                        |
| `nodejs.eventloop.delay.p99`   | gauge     | The event loop's delay over the last 10 seconds                  |
| `nodejs.eventloop.utilization` | gauge     | The share of that time the event loop was busy                   |

A histogram's count is the number of requests, statements or runs, so rates and error rates come from the same
metric (requests by `http.response.status_code`, runs by `job.outcome`). Attributes hold route patterns, never paths
or IDs: each distinct value is a series the backend keeps. The process's gauges are sampled only while exporting. Add
a metric next to these, named the way the conventions name its kind, and record it with `Metric.update`.

### Logs

Every line the server writes is exported as an OTLP log record, by the log writer itself (`writeLog`), so the backend
gets exactly what stdout got, redacted the same way: the lines Effect code writes and the few written outside any
fiber alike. A record carries its severity, the `trace_id` and `span_id` it was written in (which is how the backend
shows a request's lines beside its trace), the line's fields as attributes (nested ones as dotted names), the user as
`user.id`, and an error as `exception.type`, `exception.message` and `exception.stacktrace`.

### The Resource

Every export names where it came from: `service.name` (`OTEL_SERVICE_NAME`, `app` by default), `service.version` (the
build's commit) and `deployment.environment.name` (`development` or `production`). `OTEL_RESOURCE_ATTRIBUTES` adds
more (`service.namespace=shop,host.name=web-1`), which tells several apps or servers apart in one backend.

### Running It

In development, OpenObserve runs from `compose.dev.yaml` under the `observability` profile, which `pnpm services`
doesn't start: `docker compose -f compose.dev.yaml --profile observability up -d`. Its UI is http://localhost:5080
(`dev@example.com`, password `Dev-pass-1`). Then set in `.env`:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:5080/api/default
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic ZGV2QGV4YW1wbGUuY29tOkRldi1wYXNzLTE=
```

In production it is optional and off by default, since it needs a few hundred MB of memory
([deployment.md](../deployment.md) → Traces). With `TRACE_URL` set on the error viewer, each report's `reqId` links
to its trace in the backend ("Open trace").

## The Error Viewer

`tools/error-viewer` receives Sentry envelopes at `/api/1/envelope/`, keeps their `event` items in SQLite and shows
them on a dashboard. It runs as its own process with its own database, so it keeps working when the app or Postgres
is down. Its settings and internals are in [its README](../../tools/error-viewer/README.md), including how it groups
alike events and how it announces a new kind of error to a chat webhook (`NOTIFY_URL`).

- **List** (`/`): newest first, with filters for level, kind (`error`, `slow`, `message`, `browser`), platform,
  environment and time, a 14-day count strip and an auto-refresh toggle. Every view is a URL you can bookmark.
  Consecutive events with the same `clientId` are drawn as one card, with the client and its event count on the first
  row. Only neighbors group: a client whose events are interleaved with another's shows as separate cards.
- **Search box:** a UUID finds an `errorId`, 32 hex characters a `reqId` (16 and 8 for events stored before reqIds
  became trace IDs); `errorId:`, `reqId:`, `path:`, `route:`, `module:`, `clientId:` and `userId:` match that field
  exactly; anything else is searched in titles.
- **Detail** (`/events/<id>`): tags (each `errorId`, `reqId`, `path`, `route`, `clientId` and `userId` links to the
  list filtered by it, and the `reqId` to its trace when `TRACE_URL` is set), the exception chain with source lines for
  the app's own frames, the timeline of a slow request, the log line's fields, browser details and the raw JSON. A
  value holding a hidden or look-alike character (Arabic `ي` or `ك`, a direction mark, a ZWNJ, NBSP, a BOM,
  Arabic-Indic digits, mixed digit systems) is shown again under itself with each such character marked, e.g.
  `عل[ي U+064A Arabic yeh]`. Text the app accepts is normalized on the way in ([architecture.md](./architecture.md) →
  Free text is normalized); this shows what got through anyway.

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
projects. Do that when you need what the viewer leaves out: issues to assign and resolve, alert rules, several
projects or users.

## Configuration

| Variable                      | Default | Meaning                                                                  |
| ----------------------------- | ------- | ------------------------------------------------------------------------ |
| `LOG_LEVEL`                   | `info`  | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`             |
| `LOG_SLOW_REQUEST_MS`         | `1000`  | A request at least this slow is a warning and an error report            |
| `LOG_SLOW_QUERY_MS`           | `200`   | A query at least this slow is logged on its own                          |
| `LOG_QUERY_PARAMS`            | `false` | Log and report a failed query's parameters (personal data risk)          |
| `SENTRY_DSN`                  | (empty) | The error viewer's DSN, for the server and the browser                   |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (empty) | Where traces, metrics and logs are exported; empty sends none            |
| `OTEL_EXPORTER_OTLP_HEADERS`  | (empty) | Headers sent with every export, `name=value,…`: the backend's credential |
| `OTEL_SERVICE_NAME`           | `app`   | The name the backend lists the app under                                 |
| `OTEL_RESOURCE_ATTRIBUTES`    | (empty) | More about where the export comes from, `name=value,…`                   |

`LOG_LEVEL`, `LOG_QUERY_PARAMS` and `SENTRY_DSN` are read once at startup by `settings.server.ts`, since the writer and
the reporter work outside the runtime too; the rest are `AppConfig`'s. Both read the process's environment only
(`serverEnv`), so a value baked into the build never wins over the one the server starts with.

`.env.example` turns `LOG_QUERY_PARAMS` on, since development data is your own and the values help debugging.
Production leaves it off unless you set it.

At `LOG_LEVEL=warn`, only the slow, failed and erroring requests are written, which suits development next to the
error viewer and a busy production server. The export sends the lines that are written, so the level decides what
reaches the backend too. `fatal` and `silent` also stop error reports, which are sent from the writer.

The browser bundle reads `SENTRY_DSN` when it is built (`envPrefix` in `vite.config.ts`), so changing it needs a
rebuild. The server reads it at startup.

## Production Logs

- Each line is one JSON object: `level`, `time`, `module`, `msg`, `trace_id` and `span_id` inside a trace, `userId`
  when known, the line's own fields, and `err` for an error (type, message, stack, cause).
- The request line has `http.request.method`, `url.path`, `http.response.status_code`, `duration_ms` and `http.route`
  (the route pattern, e.g. `/notes/$noteId`, or the procedure's path, `/rpc/note/list`, for grouping). Its time per
  kind is in `msg`.
- Paths are logged without their query string, which can carry tokens.
- A healthy `/healthz` probe writes no request line, because Docker and uptime monitors poll it every few seconds. A
  slow or failing probe is logged like any other request.
