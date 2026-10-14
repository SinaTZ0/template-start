import pino from "pino";

import { env } from "~/env.server";

/*===== Logger =====*/
// Development pretty-prints through `pino-pretty` as an in-process stream. pino's `transport` option would run it in a
// worker thread, which can't resolve the module under Vite's dev server. It is a dev dependency, so it is imported only
// in development; production writes one JSON object per line to stdout for the platform to collect.
const prettyStream =
  env.NODE_ENV === "development" ? (await import("pino-pretty")).default({ ignore: "pid,hostname" }) : undefined;

/**
 * The server's one logger.
 *
 * Log errors under the `err` key so pino serializes their stack and cause: `log.error({ err, errorId }, "message")`.
 */
export const logger = pino({ level: env.LOG_LEVEL }, prettyStream);

/** A child logger that tags every line with the module it came from, e.g. `createLogger("media")`. */
export function createLogger(module: string) {
  return logger.child({ module });
}
