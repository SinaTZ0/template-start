import { performance } from "node:perf_hooks";

import { env } from "#/env.server";
import { reportSlowRequest } from "#/lib/error-reporting.server";
import { createLogger } from "#/lib/logger.server";
import { traceTimeline, traceTotals } from "#/lib/trace.server";
import type { RequestTrace } from "#/lib/trace.server";

const log = createLogger("http");

/*===== Request Log =====*/
/**
 * Logs one line per request, with its time per kind of work (procedures, queries, …). A slow request
 * is also reported to the error tracker with the timeline of its slowest spans, which shows where the time went.
 *
 * @param route The path pattern for grouping requests in production logs (`/rpc/$`), or the path when there is none.
 */
export function logRequest({
  request,
  status,
  route,
  trace,
}: {
  request: { method: string; path: string };
  status: number;
  route: string;
  trace: RequestTrace;
}) {
  const ms = Math.round(performance.now() - trace.start);
  const slow = ms >= env.LOG_SLOW_REQUEST_MS;
  const failed = status >= 500;
  // Docker and uptime monitors poll every few seconds; a healthy probe is noise.
  if (request.path === "/healthz" && !slow && !failed) return;

  const timing = traceTotals(trace);
  const breakdown = Object.entries(timing)
    .map(([kind, total]) => `${kind} ${total.count}×${total.ms}ms`)
    .join(", ");
  // Nested under `request`, which development hides: the message already says it all (`src/lib/logger.server.ts`).
  const fields = { request: { ...request, status, ms, route, timing } };
  const summary = `${request.method} ${request.path} ${status} ${ms}ms${breakdown ? ` (${breakdown})` : ""}`;

  if (failed) log.error(fields, `request failed: ${summary}`);
  else if (slow) log.warn(fields, `slow request: ${summary}`);
  else log.info(fields, summary);

  if (slow) reportSlowRequest({ method: request.method, route, ms, kinds: timing, timeline: traceTimeline(trace) });
}
