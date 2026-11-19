import { redactFields, redactText } from "#/lib/redact.server";
import { hideQueryParams, reportError } from "#/server/observability/report.server";
import type { ReportContext } from "#/server/observability/report.server";
import { requestScope } from "#/server/observability/request-scope.server";
import { observabilitySettings } from "#/server/observability/settings.server";

/*===== Levels =====*/
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const RANK: Record<LogLevel | "silent", number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Infinity,
};
const minimum = RANK[observabilitySettings.logLevel];

/*===== Errors =====*/
const MAX_CAUSE_DEPTH = 5;

/**
 * An error as a log line keeps it: its type, message, stack and own fields, then its cause the same way. Secrets in the
 * text are redacted (`#/lib/redact.server`), and a failed query's parameters are hidden unless `LOG_QUERY_PARAMS` is on:
 * they can hold personal data.
 */
export function serializeError(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) return redactFields(error);
  const { name, message, stack, cause, ...own } = error as Error & Record<string, unknown>;
  if (!observabilitySettings.queryParams) delete own.params;
  return {
    type: (error.constructor as { name?: string } | undefined)?.name ?? name,
    message: redactText(hideQueryParams(message)),
    ...(stack && { stack: redactText(hideQueryParams(stack)) }),
    ...redactFields(own),
    ...(cause !== undefined && depth < MAX_CAUSE_DEPTH && { cause: serializeError(cause, depth + 1) }),
  };
}

/*===== Output =====*/
/** What a line knows about where it was written: the request and span it belongs to, when there is one. */
export type LogContext = ReportContext & { readonly spanId?: string | undefined };

/*===== Export =====*/
/** A line as it is handed on for export: what stdout got, already redacted. */
export type ExportedLog = {
  readonly level: LogLevel;
  readonly time: Date;
  readonly module: string;
  readonly message: string;
  /** The line's fields, redacted. */
  readonly fields: Record<string, unknown>;
  /** The line's error as `serializeError` made it, redacted. */
  readonly err: unknown;
  readonly context: LogContext;
};

let exportLog: ((entry: ExportedLog) => void) | undefined;

/**
 * Sends every line written from now on to `sink` as well, or stops with `undefined`. The OTLP export sets it for as
 * long as its runtime lives (`#/server/observability/export.server`): lines go out through the one writer, so what is
 * exported is exactly what stdout got, redacted the same way.
 */
export function setLogExport(sink: ((entry: ExportedLog) => void) | undefined): void {
  exportLog = sink;
}

// Development prints one readable line per entry (and an error under it); production writes one JSON object per line
// to stdout for Docker to collect. `import.meta.env` is Vite's: a script run by tsx has none and is development.
const pretty = !import.meta.env?.PROD;

/**
 * Writes one log line. Every line of the server goes through here: Effect's logger (`#/server/observability/logger
 * .server`) and the few places outside any fiber (`createLogger`).
 *
 * The fields are redacted once, for the line and the report alike. A line at `error` or above with an error is also
 * reported to the error viewer, tagged with its request: logging an error is reporting it.
 */
export function writeLog({
  level,
  module,
  message,
  fields = {},
  err,
  context = {},
}: {
  level: LogLevel;
  module: string;
  message: string;
  fields?: Record<string, unknown>;
  err?: unknown;
  context?: LogContext;
}): void {
  if (RANK[level] < minimum) return;
  const now = new Date();
  // `Effect.log("…", value)` puts its values in the message, so the text is redacted like the fields.
  const text = redactText(message);
  const safe = redactFields(fields);
  const error = err === undefined ? undefined : serializeError(err);
  // OpenTelemetry's names for a line's place in a trace, which log collectors match a line to its trace by. The
  // trace ID is the request's ID: its `X-Request-Id` header and its reports' `reqId` tag.
  const ids = {
    ...(context.traceId && { trace_id: context.traceId }),
    ...(context.spanId && { span_id: context.spanId }),
    ...(context.userId && { userId: context.userId }),
  };

  if (pretty) {
    const extra = JSON.stringify({ module, ...ids, ...safe });
    const line = `[${now.toISOString().slice(11, 23)}] ${level.toUpperCase()}: ${text} ${extra}`;
    const under = error === undefined ? "" : `\n    err: ${JSON.stringify(error, null, 2).replaceAll("\n", "\n    ")}`;
    process.stdout.write(`${line}${under}\n`);
  } else {
    const entry = { level, time: now.toISOString(), module, msg: text, ...ids, ...safe };
    process.stdout.write(`${JSON.stringify(error === undefined ? entry : { ...entry, err: error })}\n`);
  }

  exportLog?.({ level, time: now, module, message: text, fields: safe, err: error, context });

  if (err !== undefined && RANK[level] >= RANK.error) {
    reportError({ err, message: text, fields: { module, ...safe }, context });
  }
}

/*===== Outside Effect =====*/
/** The current request, as seen from code outside any fiber. */
function scopeContext(): LogContext {
  const scope = requestScope.current();
  if (!scope) return {};
  const { traceId, method, path, clientId, userId } = scope;
  return { traceId, method, path, clientId, userId };
}

type LogMethod = (fieldsOrMessage: Record<string, unknown> | string, message?: string) => void;

/**
 * A logger for code that runs outside Effect: Better-Auth's callbacks, the server entry, the oRPC handler's
 * interceptor. Effect code logs with `Effect.log*` instead. Lines carry the current request's `trace_id` and `userId`.
 *
 * Errors go under `err`, as in Effect code: `log.error({ err, mediaId }, "could not …")`.
 */
export function createLogger(module: string): Record<LogLevel, LogMethod> {
  const method =
    (level: LogLevel): LogMethod =>
    (fieldsOrMessage, message) => {
      const { err, ...fields } = typeof fieldsOrMessage === "string" ? {} : fieldsOrMessage;
      writeLog({
        level,
        module,
        message: typeof fieldsOrMessage === "string" ? fieldsOrMessage : (message ?? ""),
        fields,
        err,
        context: scopeContext(),
      });
    };
  return {
    trace: method("trace"),
    debug: method("debug"),
    info: method("info"),
    warn: method("warn"),
    error: method("error"),
    fatal: method("fatal"),
  };
}
