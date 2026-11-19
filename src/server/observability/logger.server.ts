import { Cause, Layer, Logger, References } from "effect";
import type { LogLevel } from "effect";

import { createLogger } from "#/lib/logger.server";

/*===== Levels =====*/
const PINO_LEVEL: Record<LogLevel.LogLevel, "fatal" | "error" | "warn" | "info" | "debug" | "trace" | undefined> = {
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
const moduleLoggers = new Map<string, ReturnType<typeof createLogger>>();

/** One child logger per module, made on first use. */
function moduleLogger(module: string) {
  let log = moduleLoggers.get(module);
  if (!log) moduleLoggers.set(module, (log = createLogger(module)));
  return log;
}

/**
 * Writes Effect's log entries through the server's logger (`#/lib/logger.server`), so they look like every other line,
 * carry the request's `reqId`, are redacted, and an error-level entry with a cause is reported to the error viewer.
 *
 * The `module` annotation picks the child logger (`Effect.annotateLogs({ module: "media" })`); the other annotations
 * become fields. A failure's cause is logged under `err`.
 */
const appLogger = Logger.make((options) => {
  const level = PINO_LEVEL[options.logLevel];
  if (!level) return;
  const { module, ...fields } = options.fiber.getRef(References.CurrentLogAnnotations);
  // `Effect.log("a", value)` logs its arguments as one array.
  const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message];
  const message = parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" ");
  const err = options.cause.reasons.length > 0 ? Cause.squash(options.cause) : undefined;
  moduleLogger(typeof module === "string" ? module : "app")[level](
    err === undefined ? fields : { ...fields, err },
    message,
  );
});

/**
 * The server's Effect loggers: the app's logger, and the tracer's, which adds each entry to the current span as an
 * event. The level filter is pino's (`LOG_LEVEL`), so Effect passes everything on.
 */
export const LoggerLive = Layer.mergeAll(
  Logger.layer([appLogger, Logger.tracerLogger]),
  Layer.succeed(References.MinimumLogLevel, "All"),
);
