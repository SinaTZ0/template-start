import { performance } from "node:perf_hooks";
import { PassThrough } from "node:stream";

import { ORPCError } from "@orpc/server";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import { isRouteErrorResponse, ServerRouter } from "react-router";
import type {
  EntryContext,
  HandleErrorFunction,
  InstrumentationHandlerResult,
  InstrumentationServerHandlerResult,
  RouterContextProvider,
  ServerInstrumentation,
} from "react-router";

import { env } from "~/env.server";
import { createLogger } from "~/lib/logger.server";
import { recordSpan, runWithTrace, traceTimeline, traceTotals } from "~/lib/trace.server";
import type { RequestTrace, SpanKind } from "~/lib/trace.server";

const log = createLogger("http");

/*===== Document Rendering =====*/
// React Router's default Node entry, except that render errors go through the logger.
export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    // Bots and SPA Mode renders wait for all content, so crawlers get the full page.
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";

    // Abort after `streamTimeout`, leaving time to flush the rejected boundaries.
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000);

    const { pipe, abort } = renderToPipeableStream(<ServerRouter context={routerContext} url={request.url} />, {
      [readyOption]() {
        shellRendered = true;
        const body = new PassThrough({
          final(callback) {
            // Clear the timeout so its closure isn't retained.
            clearTimeout(timeoutId);
            timeoutId = undefined;
            callback();
          },
        });
        const stream = createReadableStreamFromReadable(body);

        responseHeaders.set("Content-Type", "text/html");
        pipe(body);
        resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
      },
      onShellError(error: unknown) {
        reject(error);
      },
      onError(error: unknown) {
        responseStatusCode = 500;
        // Errors before the shell rendered reject and reach `handleError`; only later streaming errors are logged here.
        if (shellRendered) log.error({ err: error }, "render error");
      },
    });
  });
}

/*===== Error Logging =====*/
/** Logs errors thrown by loaders, actions and rendering. React Router doesn't call it for thrown responses. */
export const handleError: HandleErrorFunction = (error, { request }) => {
  // The client went away mid-request; nothing failed on the server.
  if (request.signal.aborted) return;
  // React Router's own 404 and 405 for unmatched URLs; the request line already shows the status.
  if (isRouteErrorResponse(error)) return;

  // The global oRPC middleware already logged this one in full under its `errorId`.
  const errorId: unknown =
    error instanceof ORPCError ? (error.data as { errorId?: unknown } | undefined)?.errorId : undefined;
  if (typeof errorId === "string") return log.error({ errorId }, "route error");

  log.error({ err: error }, "route error");
};

/*===== Performance Instrumentation =====*/
/**
 * Logs one line per request, with its time per kind of work (loaders, procedures, queries, …). A slow or failed
 * request also gets the timeline of its slowest spans, which shows where the time went.
 */
function logRequest({
  request,
  result,
  trace,
}: {
  request: { method: string; url: string };
  result: InstrumentationServerHandlerResult;
  trace: RequestTrace;
}) {
  const ms = Math.round(performance.now() - trace.start);
  const slow = ms >= env.LOG_SLOW_REQUEST_MS;
  const failed = result.statusCode >= 500;
  const fields = {
    // The path without its query string, which can carry tokens. `route` is the matched pattern (`/notes/:id`), for
    // grouping requests in production logs.
    request: { method: request.method, path: new URL(request.url).pathname, status: result.statusCode, ms },
    route: result.meta?.pattern,
    timing: traceTotals(trace),
    ...((slow || failed) && { timeline: traceTimeline(trace) }),
  };

  if (failed) log.error(fields, "request failed");
  else if (slow) log.warn(fields, "slow request");
  else log.info(fields, "request");
}

/** Times a route's handler as a span named after the route (e.g. `routes/notes/notes`). */
function timeRouteHandler({ kind, routeId }: { kind: SpanKind; routeId: string }) {
  return async (handler: () => Promise<InstrumentationHandlerResult>) => {
    const start = performance.now();
    const result = await handler();
    // A thrown redirect or `data()` response is control flow, not a failure.
    const failed = result.status === "error" && !((result.error as unknown) instanceof Response);
    recordSpan({ kind, name: routeId, start, failed });
  };
}

export const instrumentations: ServerInstrumentation[] = [
  {
    handler(handler) {
      handler.instrument({
        // Everything the request runs, down to its queries, records into this trace. The time ends when the response
        // starts: streamed content that resolves later isn't counted.
        request: (handle, { request }) =>
          runWithTrace(async (trace) => {
            const result = await handle();
            logRequest({ request, result, trace });
          }),
      });
    },
    route(route) {
      route.instrument({
        middleware: timeRouteHandler({ kind: "middleware", routeId: route.id }),
        loader: timeRouteHandler({ kind: "loader", routeId: route.id }),
        action: timeRouteHandler({ kind: "action", routeId: route.id }),
      });
    },
  },
];
