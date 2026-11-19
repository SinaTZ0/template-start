import { Cause, Layer, Logger, References } from "effect";
import type { LogLevel as EffectLogLevel } from "effect";

import { redactFields, redactText } from "#/lib/redact.server";
import { writeLog } from "#/server/observability/log.server";
import type { LogLevel } from "#/server/observability/log.server";

/*===== Levels =====*/
const LEVEL: Record<EffectLogLevel.LogLevel, LogLevel | undefined> = {
  All: "trace",
  Trace: "trace",
  Debug: "debug",
  Info: "info",
  Warn: "warn",
  Error: "error",
  Fatal: "fatal",
  None: undefined,
};

/*===== Logger =====*/
/**
 * Effect's log entries as the server's log lines (`writeLog`), so they look like every other line.
 *
 * - The `module` annotation names the line's module (`Effect.annotateLogs({ module: "media" })`); `userId` and
 *   `clientId` tag the line and its report; every other annotation is a field.
 * - The line carries the trace and span it was written in (`reqId`, `spanId`), so a request's lines and its trace are
 *   found by one ID.
 * - A logged cause is the line's `err`, so `Effect.logError("…", cause)` is reported to the error viewer.
 * - The line is also an event of the current span, redacted, so an exported trace carries its logs.
 */
const appLogger = Logger.make((options) => {
  const level = LEVEL[options.logLevel];
  if (!level) return;
  const { module, userId, clientId, ...fields } = options.fiber.getRef(References.CurrentLogAnnotations);
  // `Effect.log("a", value)` logs its arguments as one array.
  const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message];
  const message = parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" ");
  const span = options.fiber.cache.span;
  const err = options.cause.reasons.length > 0 ? Cause.squash(options.cause) : undefined;

  // The line as an event of the span it was written in, so an exported trace shows its logs. Redacted like the line:
  // Effect's own tracer logger would copy the fields as they are.
  if (span?._tag === "Span" && span.status._tag !== "Ended") {
    span.event(message, BigInt(options.date.getTime()) * 1_000_000n, {
      "log.level": level,
      ...(typeof module === "string" && { "log.module": module }),
      ...redactFields(fields),
      ...(err !== undefined && { "exception.message": redactText(Cause.pretty(options.cause)) }),
    });
  }

  writeLog({
    level,
    module: typeof module === "string" ? module : "app",
    message,
    fields,
    err,
    context: {
      traceId: span?.traceId,
      spanId: span?.spanId,
      userId: typeof userId === "string" ? userId : undefined,
      clientId: typeof clientId === "string" ? clientId : undefined,
    },
  });
});

/**
 * The server's Effect logger, in place of Effect's defaults. The level filter is the writer's (`LOG_LEVEL`), so Effect
 * passes everything on.
 */
export const LoggerLive = Layer.mergeAll(Logger.layer([appLogger]), Layer.succeed(References.MinimumLogLevel, "All"));
