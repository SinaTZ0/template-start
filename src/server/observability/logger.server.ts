import { Cause, Layer, Logger, References } from "effect";
import type { LogLevel as EffectLogLevel } from "effect";

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
 */
const appLogger = Logger.make((options) => {
  const level = LEVEL[options.logLevel];
  if (!level) return;
  const { module, userId, clientId, ...fields } = options.fiber.getRef(References.CurrentLogAnnotations);
  // `Effect.log("a", value)` logs its arguments as one array.
  const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message];
  const message = parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" ");
  const span = options.fiber.cache.span;
  writeLog({
    level,
    module: typeof module === "string" ? module : "app",
    message,
    fields,
    err: options.cause.reasons.length > 0 ? Cause.squash(options.cause) : undefined,
    context: {
      traceId: span?.traceId,
      spanId: span?.spanId,
      userId: typeof userId === "string" ? userId : undefined,
      clientId: typeof clientId === "string" ? clientId : undefined,
    },
  });
});

/**
 * The server's Effect loggers: the app's, and the tracer's, which adds each entry to the current span as an event. The
 * level filter is the writer's (`LOG_LEVEL`), so Effect passes everything on.
 */
export const LoggerLive = Layer.mergeAll(
  Logger.layer([appLogger, Logger.tracerLogger]),
  Layer.succeed(References.MinimumLogLevel, "All"),
);
