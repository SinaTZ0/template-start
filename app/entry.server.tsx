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
  HandleDataRequestFunction,
  HandleErrorFunction,
  InstrumentationHandlerResult,
  InstrumentationServerHandlerResult,
  RouterContextProvider,
  ServerInstrumentation,
} from "react-router";

import { env } from "~/env.server";
import { readClientId } from "~/lib/client-id";
import { reportSlowRequest } from "~/lib/error-reporting.server";
import { createLogger } from "~/lib/logger.server";
import { currentTrace, runWithTrace, span, traceTimeline, traceTotals } from "~/lib/trace.server";
import type { RequestTrace, SpanKind } from "~/lib/trace.server";
import { startMediaCleanup } from "~/orpc/media/cleanup.server";

const log = createLogger("http");

/*===== Background Jobs =====*/
// The server entry is loaded once when the server starts, which makes it the place to start in-process jobs.
startMediaCleanup();

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
  setRequestIdHeader(responseHeaders);

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

/*===== Request ID =====*/
/**
 * The root middleware sets `X-Request-Id` on every routed response (`app/root.tsx`). A URL no route matches runs no
 * middleware, but its 404 still passes through `handleRequest` (a page) or `handleDataRequest` (a client navigation's
 * `.data` request), which set it here.
 */
function setRequestIdHeader(headers: Headers) {
  const id = currentTrace()?.id;
  if (id) headers.set("X-Request-Id", id);
}

export const handleDataRequest: HandleDataRequestFunction = (response) => {
  setRequestIdHeader(response.headers);
  return response;
};

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
 * Logs one line per request, with its time per kind of work (loaders, procedures, queries, …). A slow request is also
 * reported to the error tracker with the timeline of its slowest spans, which shows where the time went.
 */
function logRequest({
  request,
  result,
  trace,
}: {
  request: { method: string; path: string };
  result: InstrumentationServerHandlerResult;
  trace: RequestTrace;
}) {
  const ms = Math.round(performance.now() - trace.start);
  const slow = ms >= env.LOG_SLOW_REQUEST_MS;
  const failed = result.statusCode >= 500;
  // Docker and uptime monitors poll every few seconds; a healthy probe is noise.
  if (request.path === "/healthz" && !slow && !failed) return;

  const timing = traceTotals(trace);
  const breakdown = Object.entries(timing)
    .map(([kind, total]) => `${kind} ${total.count}×${total.ms}ms`)
    .join(", ");
  // `route` is the matched pattern (`/notes/:id`), for grouping requests in production logs.
  // React Router gives top-level patterns without their leading slash (`notes`).
  const pattern = result.meta?.pattern;
  const route = pattern === undefined ? request.path : `/${pattern.replace(/^\//, "")}`;
  // Nested under `request`, which development hides: the message already says it all (`app/lib/logger.server.ts`).
  const fields = { request: { ...request, status: result.statusCode, ms, route, timing } };
  const summary = `${request.method} ${request.path} ${result.statusCode} ${ms}ms${breakdown ? ` (${breakdown})` : ""}`;

  if (failed) log.error(fields, `request failed: ${summary}`);
  else if (slow) log.warn(fields, `slow request: ${summary}`);
  else log.info(fields, summary);

  if (slow) reportSlowRequest({ method: request.method, route, ms, kinds: timing, timeline: traceTimeline(trace) });
}

/**
 * Times a route's handler as a span named after the route (e.g. `routes/notes/notes`). The handler runs inside the
 * span, so the procedures and queries it starts become its children in the timeline.
 */
function timeRouteHandler({ kind, routeId }: { kind: SpanKind; routeId: string }) {
  return async (handler: () => Promise<InstrumentationHandlerResult>) => {
    await span(
      {
        kind,
        name: routeId,
        // A thrown redirect or `data()` response is control flow, not a failure.
        isFailure: (result) => result.status === "error" && !((result.error as unknown) instanceof Response),
      },
      handler,
    );
  };
}

export const instrumentations: ServerInstrumentation[] = [
  {
    handler(handler) {
      handler.instrument({
        // Everything the request runs, down to its queries, records into this trace. The time ends when the response
        // starts: streamed content that resolves later isn't counted.
        request: (handle, { request }) => {
          // The path without its query string, which can carry tokens.
          const line = { method: request.method, path: new URL(request.url).pathname };
          const clientId = readClientId(request.headers.get("cookie"));
          return runWithTrace({ ...line, clientId }, async (trace) => {
            const result = await handle();
            logRequest({ request: line, result, trace });
          });
        },
      });
    },
    route(route) {
      route.instrument({
        // The root's middleware only sets `X-Request-Id` around the whole request (`app/root.tsx`). Timed, its span
        // would hold every other span and count the whole request as middleware time.
        ...(route.id !== "root" && { middleware: timeRouteHandler({ kind: "middleware", routeId: route.id }) }),
        loader: timeRouteHandler({ kind: "loader", routeId: route.id }),
        action: timeRouteHandler({ kind: "action", routeId: route.id }),
      });
    },
  },
];
