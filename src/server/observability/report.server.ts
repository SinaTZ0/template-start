import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";

import { redactText, redactUrl } from "#/lib/redact.server";
import { createReportThrottle, errorThrottleKey } from "#/lib/report-throttle.server";
import { observabilitySettings } from "#/server/observability/settings.server";
import type { SpanKind, Timeline } from "#/server/observability/timeline";

/*===== Query Parameters =====*/
/**
 * Drizzle's "Failed query" messages end with the query's parameters, which can hold personal data. They are replaced
 * with `(hidden)` in logs and error reports unless `LOG_QUERY_PARAMS` is on.
 */
export function hideQueryParams(text: string): string {
  if (observabilitySettings.queryParams) return text;
  return text.replace(/\nparams: [\s\S]*$/, "\nparams: (hidden)");
}

/**
 * Hides secrets and failed queries' parameters in what the SDK took from the error itself: every exception's message
 * (causes included), the event message and the request URL. The log line's fields (`contexts.log`) arrive already
 * redacted from the logger, which redacts them once for both the log line and the report. Tags are IDs and paths.
 */
function scrubEvent(event: ErrorEvent): ErrorEvent {
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactText(hideQueryParams(exception.value));
  }
  if (event.message) event.message = redactText(event.message);
  if (event.request?.url) event.request.url = redactUrl(event.request.url);
  return event;
}

/*===== Setup =====*/
// The error viewer (tools/error-viewer, docs/backend/logging.md) speaks Sentry's protocol. Without `SENTRY_DSN` nothing
// is sent and every function below is a no-op, so development and tests need no tracker. Only errors and messages are
// sent: tracing stays off (no `tracesSampleRate`), since the viewer ignores it. The dev server re-evaluates this module
// on reload, hence the guard.
if (observabilitySettings.sentryDsn && !Sentry.isInitialized()) {
  Sentry.init({
    dsn: observabilitySettings.sentryDsn,
    environment: observabilitySettings.environment,
    // The build's commit (`vite.config.ts`), so the viewer can say which build an error came from. Only Vite defines
    // `import.meta.env`: a seed run by tsx, or bundled by esbuild for the server, imports this module without it.
    release: import.meta.env?.APP_RELEASE || undefined,
    // The SDK collects request data by default. None of it is needed to fix a bug, and cookies, headers, bodies and
    // query strings can carry sessions, tokens and personal data. Stack frames keep their source lines.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: observabilitySettings.queryParams,
      stackFrameVariables: false,
    },
    // The SDK cuts contexts off below this depth. 4 keeps the timeline's rows: contexts → timeline → rows → row.
    normalizeDepth: 4,
    beforeSend: scrubEvent,
  });
}

/*===== Throttling =====*/
// The error viewer limits each address, and every server report comes from one, so repeats must not use up the budget
// the errors that differ need (`src/lib/report-throttle.server.ts`). One slow report per route a minute is enough to
// see a route is slow; its log line is still written for every request.
const throttleError = createReportThrottle({ limit: 5 });
const throttleSlowRequest = createReportThrottle({ limit: 1 });

/*===== Reporting =====*/
/** What a report knows about the request it came from. */
export type ReportContext = {
  readonly traceId?: string | undefined;
  readonly method?: string | undefined;
  readonly path?: string | undefined;
  readonly clientId?: string | undefined;
  readonly userId?: string | undefined;
};

/**
 * Tags every report with the request it came from, so its log lines and trace can be found by `reqId` (the trace ID),
 * with the browser's `clientId`, so the viewer can group it with that browser's own errors, and with the signed-in
 * user's `userId`.
 */
function requestTags({ traceId, method, path, clientId, userId }: ReportContext): Record<string, string> {
  return {
    ...(traceId && { reqId: traceId }),
    ...(method && path && { method, path }),
    ...(clientId && { clientId }),
    ...(userId && { userId }),
  };
}

/**
 * Sends an error to the tracker. The log writer calls it for every error-level line with an error
 * (`#/server/observability/log.server`), so app code logs errors and never calls this directly. At most 5 alike errors a minute are sent (`errorThrottleKey`); the next one sent carries
 * how many were left out as `throttle.suppressed`.
 *
 * @param fields The log line's other fields. `errorId` (the ID a client receives for a 500) and `module` become
 * searchable tags; the rest is attached as context.
 */
export function reportError({
  err,
  message,
  fields,
  context,
}: {
  err: unknown;
  message: string | undefined;
  fields: Record<string, unknown>;
  context: ReportContext;
}) {
  if (!Sentry.isEnabled()) return;
  const suppressed = throttleError(errorThrottleKey(err));
  if (suppressed === undefined) return;

  const { errorId, module, ...rest } = fields;
  Sentry.captureException(err, {
    tags: {
      ...requestTags(context),
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
  context,
}: {
  method: string;
  route: string;
  ms: number;
  kinds: Partial<Record<SpanKind, { count: number; ms: number }>>;
  timeline: Timeline;
  context: ReportContext;
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
    tags: { ...requestTags(context), route },
    contexts: {
      timeline: {
        ...timeline,
        kinds: Object.entries(kinds).map(([kind, total]) => ({ kind, ...total })),
        ...(skipped > 0 && { skipped }),
      },
    },
  });
}
