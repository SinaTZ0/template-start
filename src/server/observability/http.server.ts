import { performance } from "node:perf_hooks";

import { Data, Effect, Metric } from "effect";

import { readClientId } from "#/lib/client-id";
import { AppConfig } from "#/server/config.server";
import { writeLog } from "#/server/observability/log.server";
import { requestDuration } from "#/server/observability/metrics.server";
import { reportSlowRequest } from "#/server/observability/report.server";
import { requestScope } from "#/server/observability/request-scope.server";
import type { RequestScope } from "#/server/observability/request-scope.server";
import { takeRequestRecord } from "#/server/observability/request-spans.server";
import { buildTimeline } from "#/server/observability/timeline";

/*===== Response Headers =====*/
/** Sets a header, copying the response first when its headers are immutable (`Response.redirect`, a proxied fetch). */
function withHeader({ response, name, value }: { response: Response; name: string; value: string }): Response {
  try {
    response.headers.set(name, value);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    copy.headers.set(name, value);
    return copy;
  }
}

/*===== Server Errors =====*/
/**
 * What the request's span fails with when the response is a 5xx, so the trace reads as failed the way OpenTelemetry
 * expects of a server span. It carries the response, which is still sent.
 */
class ServerErrorResponse extends Data.TaggedError("ServerErrorResponse")<{
  readonly message: string;
  readonly handled: Handled;
}> {}

type Handled = { readonly response: Response; readonly scope: RequestScope };

/*===== Request =====*/
/**
 * Handles one request inside its own trace (docs/backend/logging.md):
 *
 * - **A root span** (`GET /notes/$noteId`, kind `server`) that every Effect the request starts joins, procedures called
 *   in-process by loaders included, through the request scope (`#/server/observability/request-scope.server`). Its
 *   name and attributes are OpenTelemetry's for an HTTP server, and a 5xx response ends it as failed.
 * - **One line** with the time per kind of work: `GET /notes 200 45ms (procedure 2×34ms, db 3×9ms)`. A 5xx is an
 *   error line, a request at least `LOG_SLOW_REQUEST_MS` long a warning, also reported to the error viewer with the
 *   timeline of its spans. Healthy health checks aren't written: Docker polls every few seconds.
 * - **`X-Request-Id`**: the trace ID, which the line, its error reports and the exported trace all carry.
 *
 * The time ends when the response starts: content streamed in later isn't counted.
 *
 * @param route The path's route pattern (`/notes/$noteId`), so a route's requests group together in every locale.
 * @param handle The framework's handler, run inside the request scope.
 */
// Untraced: a span here would be the root span's parent, and the root span must have none.
export const observeRequest = Effect.fnUntraced(function* ({
  request,
  route,
  handle,
}: {
  request: Request;
  route: string;
  handle: () => Promise<Response>;
}) {
  const { log } = yield* AppConfig;
  const method = request.method;
  const url = new URL(request.url);
  // The path without its query string, which can carry tokens.
  const path = url.pathname;
  // As the visitor's browser used it: Caddy speaks plain HTTP to the app and names the original scheme.
  const scheme = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const clientId = readClientId(request.headers.get("cookie"));

  /*------ Handle ------*/
  const { response, scope } = yield* Effect.gen(function* () {
    const span = yield* Effect.orDie(Effect.currentSpan);
    const current: RequestScope = { traceId: span.traceId, span, method, path, clientId, userId: undefined };
    const handled = yield* Effect.promise(() => requestScope.run(current, handle)).pipe(
      // Start turns route and render errors into responses; only a failure of the handler itself lands here.
      Effect.catchCause((cause) =>
        Effect.logError("unhandled request error", cause).pipe(
          Effect.annotateLogs({ module: "http" }),
          Effect.as(new Response("Internal Server Error", { status: 500 })),
        ),
      ),
    );
    yield* Effect.annotateCurrentSpan({ "http.response.status_code": handled.status, "http.route": route });
    const result: Handled = { response: handled, scope: current };
    if (handled.status < 500) return result;
    yield* Effect.annotateCurrentSpan("error.type", String(handled.status));
    return yield* new ServerErrorResponse({ message: `HTTP ${handled.status}`, handled: result });
  }).pipe(
    Effect.withSpan(`${method} ${route}`, {
      kind: "server",
      root: true,
      attributes: { "http.request.method": method, "url.path": path, "url.scheme": scheme },
    }),
    Effect.catchTag("ServerErrorResponse", (error) => Effect.succeed(error.handled)),
  );

  /*------ Line ------*/
  const record = takeRequestRecord(scope.traceId);
  const ms = record ? Math.round(performance.now() - record.start) : 0;
  const status = response.status;
  const slow = ms >= log.slowRequestMs;
  const failed = status >= 500;
  yield* requestDuration.pipe(
    Metric.withAttributes({
      "http.request.method": method,
      "http.route": route,
      "http.response.status_code": String(status),
    }),
    Metric.update(ms / 1000),
  );
  if (!(path === "/healthz" && !slow && !failed)) {
    const totals = record?.totals ?? {};
    const breakdown = Object.entries(totals)
      .map(([kind, total]) => `${kind} ${total.count}×${Math.round(total.ms)}ms`)
      .join(", ");
    const summary = `${method} ${path} ${status} ${ms}ms${breakdown ? ` (${breakdown})` : ""}`;
    // The line belongs to the request's own span.
    const context = {
      traceId: scope.traceId,
      spanId: scope.span.spanId,
      method,
      path,
      clientId,
      userId: scope.userId,
    };
    // Named as the request's span and metric name them, so a line, a trace and a chart are searched the same way.
    const fields = {
      "http.request.method": method,
      "url.path": path,
      "http.response.status_code": status,
      "http.route": route,
      duration_ms: ms,
    };
    if (failed) writeLog({ level: "error", module: "http", message: `request failed: ${summary}`, fields, context });
    else if (slow) writeLog({ level: "warn", module: "http", message: `slow request: ${summary}`, fields, context });
    else writeLog({ level: "info", module: "http", message: summary, fields, context });

    if (slow && record) {
      reportSlowRequest({
        method,
        route,
        ms,
        kinds: Object.fromEntries(
          Object.entries(record.totals).map(([kind, total]) => [
            kind,
            { count: total.count, ms: Math.round(total.ms) },
          ]),
        ),
        timeline: buildTimeline({ spans: record.spans, totalMs: ms }),
        context,
      });
    }
  }

  return withHeader({ response, name: "X-Request-Id", value: scope.traceId });
});
