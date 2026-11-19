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

// Development prints one readable line per entry (and an error under it); production writes one JSON object per line
// to stdout for Docker to collect. `import.meta.env` is Vite's: a script run by tsx has none and is development.
const pretty = !import.meta.env?.PROD;

function time(): string {
  return new Date().toISOString().slice(11, 23);
}

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
  const safe = redactFields(fields);
  const ids = {
    ...(context.traceId && { reqId: context.traceId }),
    ...(context.spanId && { spanId: context.spanId }),
    ...(context.userId && { userId: context.userId }),
  };

  if (pretty) {
    const extra = JSON.stringify({ module, ...ids, ...safe });
    const line = `[${time()}] ${level.toUpperCase()}: ${message} ${extra}`;
    const error =
      err === undefined ? "" : `\n    err: ${JSON.stringify(serializeError(err), null, 2).replaceAll("\n", "\n    ")}`;
    process.stdout.write(`${line}${error}\n`);
  } else {
    const entry = { level, time: new Date().toISOString(), module, msg: message, ...ids, ...safe };
    process.stdout.write(`${JSON.stringify(err === undefined ? entry : { ...entry, err: serializeError(err) })}\n`);
  }

  if (err !== undefined && RANK[level] >= RANK.error) {
    reportError({ err, message, fields: { module, ...safe }, context });
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
 * interceptor. Effect code logs with `Effect.log*` instead. Lines carry the current request's `reqId` and `userId`.
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
