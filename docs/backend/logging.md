# Logging and Performance

How the server logs, and how to find out why a request is slow.

## Overview

```text
request ──▶ entry.server.tsx (trace starts, reqId) ──▶ middleware ▸ loader/action ▸ procedure ▸ db / storage / task
                                                                                                      │
                     one summary line per request ◀── trace (time per kind + slowest spans) ◀──────┘
```

- **One logger.** Server code logs through pino (`app/lib/logger.server.ts`), never `console`. Better-Auth's logs and
  React Router's loader, action and render errors go through it too.
- **One trace per request.** `app/lib/trace.server.ts` keeps the request's timings in `AsyncLocalStorage`, so a query
  deep inside a service lands in the right request without anything being passed down.
- **One line per request**, with its status, duration and where the time went. A slow or failed request also gets the
  timeline of its slowest spans.

## Writing Logs

Take a tagged child per module, keep the message short and constant, and put variable details in the object so logs
stay searchable:

```ts
const log = createLogger("media");

log.info({ mediaId, kind }, "media uploaded");
log.error({ err, mediaId }, "could not clean up the variants");
```

- Log errors under the `err` key; only that key gets the error serializer below.
- The global oRPC middleware logs every unexpected procedure failure once, with the `errorId` the client receives.
  Don't log and rethrow the same error in services.
- Every line written while a request is handled carries its `reqId`. Search for it to see everything one request did.

## Errors

The `err` serializer keeps errors short:

- **Trimmed stacks.** Only the app's own frames are kept (up to 6, and 3 for each cause), with paths relative to the
  project. Frames from `node_modules`, node internals and `<anonymous>` are counted in a single
  `… 12 framework frames hidden` line. A stack with no app frame keeps its top library frames, so it still points
  somewhere.
- **Causes**, three levels deep.
- **Small properties only.** Primitives and objects up to 500 characters of JSON are kept (oRPC's `code` and `data`,
  Postgres's `code` and `constraint`, AWS's `$metadata`). Postgres's internal `file`, `line` and `routine` are dropped.
- **No query parameters.** Drizzle puts a failed query's parameters in its message and on the error. They can hold
  personal data, so the message shows `params: (hidden)` and the property is dropped. Long messages are cut at 1000
  characters.

## Request Timing

### What Is Timed

| Kind         | Recorded by                                          | Name                         |
| ------------ | ---------------------------------------------------- | ---------------------------- |
| `middleware` | React Router instrumentation (`entry.server.tsx`)    | route ID: `routes/notes/...` |
| `loader`     | React Router instrumentation                         | route ID                     |
| `action`     | React Router instrumentation                         | route ID                     |
| `procedure`  | `traceProcedureMiddleware`, first on the implementer | procedure path: `note.list`  |
| `db`         | the traced pool in `app/db/client.server.ts`         | the SQL, without parameters  |
| `storage`    | S3 client middleware in `app/lib/storage.server.ts`  | command: `PutObject`         |
| `task`       | `span(...)` calls in app code                        | whatever the call names      |

Kinds nest: a loader's time includes the procedures it called, and those include their queries. Add the kinds up and
you count the same time more than once.

Procedures are timed the same way over HTTP (`/rpc/*`) and through the server client in a loader.

### Timing Other Work

Wrap anything that may be slow and isn't covered above, such as CPU-heavy processing or a call to an external API:

```ts
import { span } from "~/lib/trace.server";

const processed = await span({ kind: "task", name: "media.processImage" }, () => processImage({ file, kind }));
```

Outside a request (startup, `pnpm db:seed`, tests) `span` just runs the function.

### Reading the Output

Development prints one line per request:

```text
INFO: [638455eb] http: GET /notes 200 45ms (loader 2×30ms, procedure 1×28ms, db 2×5ms)
```

`loader 2×30ms` means two loaders ran, taking 30 ms in total. A request slower than `LOG_SLOW_REQUEST_MS` is a
warning, and a 5xx is an error. Both also get a timeline of their 15 slowest spans, in the order they started:

```text
WARN: [eb3753c1] http: slow request: GET /notes 200 1420ms (loader 1×1390ms, procedure 1×1385ms, db 41×1310ms)
    timeline: [
      "   12ms  at +4ms     loader     routes/notes_layout/notes-layout",
      " 1390ms  at +18ms    loader     routes/notes/notes",
      " 1385ms  at +20ms    procedure  note.list",
      "  210ms  at +31ms    db         select \"id\", \"title\" from \"note\" where ...",
      ...
    ]
```

- **One span takes most of the time:** that is the bottleneck. For a query, check its plan and indexes.
- **Many fast `db` spans** (`db 41×…`): a query inside a loop (N+1). Fetch them in one query or a join.
- **Gaps between spans:** time no span covers, usually rendering or CPU work. Wrap the suspect in a `task` span.
- **`(failed)`:** that span threw. Its error is logged separately with the same `reqId`.

A query slower than `LOG_SLOW_QUERY_MS` also gets its own `slow query` warning, inside or outside a request.

### Limits

- A request's time ends when its response starts. Content streamed in later (deferred loader data) isn't counted.
- A trace keeps at most 300 spans. Spans past that still count in the totals but not in the timeline.
- Only queries through `db` (`app/db/client.server.ts`) are traced. A separate `pg` pool or client isn't.

## Configuration

| Variable              | Default | Meaning                                                      |
| --------------------- | ------- | ------------------------------------------------------------ |
| `LOG_LEVEL`           | `info`  | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `LOG_SLOW_REQUEST_MS` | `1000`  | A request at least this slow is a warning with its timeline  |
| `LOG_SLOW_QUERY_MS`   | `200`   | A query at least this slow is logged on its own              |

At `LOG_LEVEL=warn`, only the slow, failed and erroring requests are written, which suits a busy production server.

## Production

- Production writes one JSON object per line to stdout; development pretty-prints through `pino-pretty`.
- The request summary is structured for log queries: `request.{method,path,status,ms}`, `route` (the matched pattern,
  e.g. `/notes/:id`, for grouping), `timing.<kind>.{count,ms}`, and `timeline` on slow or failed requests.
- Paths are logged without their query string, which can carry tokens.
- A healthy `/healthz` probe writes no request line, because Docker and uptime monitors poll it every few seconds. A
  slow or failing probe is logged like any other request.
- `react-router-serve` also writes its own plain-text access line for each request. Moving to a custom Express server
  would remove it.
