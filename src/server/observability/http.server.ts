import { performance } from "node:perf_hooks";

import { Effect } from "effect";

import { readClientId } from "#/lib/client-id";
import { AppConfig } from "#/server/config.server";
import { writeLog } from "#/server/observability/log.server";
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

/*===== Request =====*/
/**
 * Handles one request inside its own trace (docs/backend/logging.md):
 *
 * - **A root span** (`GET /notes/$noteId`, kind `server`) that every Effect the request starts joins, procedures called
 *   in-process by loaders included, through the request scope (`#/server/observability/request-scope.server`).
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
  // The path without its query string, which can carry tokens.
  const path = new URL(request.url).pathname;
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
    return { response: handled, scope: current };
  }).pipe(
    Effect.withSpan(`${method} ${route}`, {
      kind: "server",
      root: true,
      attributes: { "http.request.method": method, "url.path": path },
    }),
  );

  /*------ Line ------*/
  const record = takeRequestRecord(scope.traceId);
  const ms = record ? Math.round(performance.now() - record.start) : 0;
  const status = response.status;
  const slow = ms >= log.slowRequestMs;
  const failed = status >= 500;
  if (!(path === "/healthz" && !slow && !failed)) {
    const totals = record?.totals ?? {};
    const breakdown = Object.entries(totals)
      .map(([kind, total]) => `${kind} ${total.count}×${Math.round(total.ms)}ms`)
      .join(", ");
    const summary = `${method} ${path} ${status} ${ms}ms${breakdown ? ` (${breakdown})` : ""}`;
    const context = { traceId: scope.traceId, method, path, clientId, userId: scope.userId };
    // Nested under `request`, which the readable development line leaves to the message.
    const fields = { request: { method, path, status, ms, route } };
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
