import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";

import { env } from "~/env.server";
import { createReportThrottle, errorThrottleKey } from "~/lib/report-throttle.server";
import { currentTrace } from "~/lib/trace.server";
import type { SpanKind, Timeline } from "~/lib/trace.server";

/*===== Query Parameters =====*/
/**
 * Drizzle's "Failed query" messages end with the query's parameters, which can hold personal data. They are replaced
 * with `(hidden)` in logs and error reports unless `LOG_QUERY_PARAMS` is on.
 */
export function hideQueryParams(text: string): string {
  if (env.LOG_QUERY_PARAMS) return text;
  return text.replace(/\nparams: [\s\S]*$/, "\nparams: (hidden)");
}

/** Applies `hideQueryParams` to every exception in the event, causes included. */
function scrubEvent(event: ErrorEvent): ErrorEvent {
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = hideQueryParams(exception.value);
  }
  return event;
}

/*===== Setup =====*/
// The error viewer (tools/error-viewer, docs/backend/logging.md) speaks Sentry's protocol. Without `SENTRY_DSN` nothing
// is sent and every function below is a no-op, so development and tests need no tracker. Only errors and messages are
// sent: tracing stays off (no `tracesSampleRate`), since the viewer ignores it. The dev server re-evaluates this module
// on reload, hence the guard.
if (env.SENTRY_DSN && !Sentry.isInitialized()) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // The SDK collects request data by default. None of it is needed to fix a bug, and cookies, headers, bodies and
    // query strings can carry sessions, tokens and personal data. Stack frames keep their source lines.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: env.LOG_QUERY_PARAMS,
      stackFrameVariables: false,
    },
    // The SDK cuts contexts off below this depth. 4 keeps the timeline's rows: contexts → timeline → rows → row.
    normalizeDepth: 4,
    beforeSend: scrubEvent,
  });
}

/*===== Throttling =====*/
// The error viewer limits each address, and every server report comes from one, so repeats must not use up the budget
// the errors that differ need (`app/lib/report-throttle.server.ts`). One slow report per route a minute is enough to
// see a route is slow; its log line is still written for every request.
const throttleError = createReportThrottle({ limit: 5 });
const throttleSlowRequest = createReportThrottle({ limit: 1 });

/*===== Reporting =====*/
/**
 * Tags every report with the request it came from, so its log lines can be found by `reqId`, and with the browser's
 * `clientId`, so the viewer can group it with that browser's own errors.
 */
function requestTags(): Record<string, string> {
  const trace = currentTrace();
  if (!trace) return {};
  const { method, path, clientId } = trace.request ?? {};
  return {
    reqId: trace.id,
    ...(method && path && { method, path }),
    ...(clientId && { clientId }),
  };
}

/**
 * Sends an error to the tracker. The logger calls it for every `log.error({ err }, …)`, so app code logs errors and
 * never calls this directly. At most 5 alike errors a minute are sent (`errorThrottleKey`); the next one sent carries
 * how many were left out as `throttle.suppressed`.
 *
 * @param fields The log line's other fields. `errorId` (the ID a client receives for a 500) and `module` become
 * searchable tags; the rest is attached as context.
 */
export function reportError({
  err,
  message,
  fields,
}: {
  err: unknown;
  message: string | undefined;
  fields: Record<string, unknown>;
}) {
  if (!Sentry.isEnabled()) return;
  const suppressed = throttleError(errorThrottleKey(err));
  if (suppressed === undefined) return;

  const { errorId, module, ...rest } = fields;
  Sentry.captureException(err, {
    tags: {
      ...requestTags(),
      ...(typeof errorId === "string" && { errorId }),
      ...(typeof module === "string" && { module }),
    },
    contexts: { log: { message, ...rest }, ...(suppressed > 0 && { throttle: { suppressed } }) },
  });
}

/**
 * Reports a request slower than `LOG_SLOW_REQUEST_MS` as a warning. The fingerprint starts with `slow-request`, which
 * is how the error viewer tells these apart from errors; a grouping tracker (Bugsink, Sentry) would also group them by
 * method and route pattern. Only one report per method and route is sent a minute; the next one carries how many were
 * left out as `timeline.skipped`.
 *
 * @param kinds Count and total time per kind of work, in the order each kind first ran (`traceTotals`).
 * @param timeline The request's spans as a tree (`traceTimeline`).
 */
export function reportSlowRequest({
  method,
  route,
  ms,
  kinds,
  timeline,
}: {
  method: string;
  route: string;
  ms: number;
  kinds: Partial<Record<SpanKind, { count: number; ms: number }>>;
  timeline: Timeline;
}) {
  if (!Sentry.isEnabled()) return;
  const skipped = throttleSlowRequest(`${method} ${route}`);
  if (skipped === undefined) return;

  // `captureEvent` rather than `captureMessage`, which would attach the stack of this call: the same for every slow
  // request, and no clue to where the time went. The timeline is that clue (docs/backend/logging.md → Request Timing).
  // The viewer draws the `timeline` context as a waterfall. Kinds go as a list, since JSON objects lose their order.
  Sentry.captureEvent({
    message: `Slow request: ${method} ${route} (${ms}ms)`,
    level: "warning",
    fingerprint: ["slow-request", method, route],
    tags: { ...requestTags(), route },
    contexts: {
      timeline: {
        ...timeline,
        kinds: Object.entries(kinds).map(([kind, total]) => ({ kind, ...total })),
        ...(skipped > 0 && { skipped }),
      },
    },
  });
}
