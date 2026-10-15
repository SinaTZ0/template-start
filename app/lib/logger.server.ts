import pino from "pino";

import { env } from "~/env.server";
import { hideQueryParams, reportError } from "~/lib/error-reporting.server";
import { currentTrace } from "~/lib/trace.server";

/*===== Error Serializer =====*/
const MAX_CAUSE_DEPTH = 5;

/**
 * pino's standard serializer, minus failed queries' parameters. Drizzle puts them at the end of its error's message
 * and on the error itself; they can hold personal data, so both are hidden unless `LOG_QUERY_PARAMS` is on.
 *
 * pino joins the messages and stacks of the whole cause chain into one string each, with a cause's message following
 * the parameters, so each error's own message is scrubbed and swapped in rather than cutting the joined text.
 */
function serializeError(value: unknown): unknown {
  const serialized = pino.stdSerializers.err(value as Error) as unknown;
  if (env.LOG_QUERY_PARAMS || typeof serialized !== "object" || serialized === null) return serialized;

  const fields = serialized as Record<string, unknown>;
  delete fields.params;

  let error: unknown = value;
  for (let depth = 0; error instanceof Error && depth < MAX_CAUSE_DEPTH; depth++) {
    const hidden = hideQueryParams(error.message);
    if (hidden !== error.message) {
      for (const key of ["message", "stack"]) {
        if (typeof fields[key] === "string") fields[key] = fields[key].replace(error.message, hidden);
      }
    }
    error = error.cause;
  }
  return fields;
}

/*===== Development Output =====*/
// Development pretty-prints through `pino-pretty` as an in-process stream: pino's `transport` option would run it in a
// worker thread, which can't resolve the module under Vite's dev server. It is a dev dependency, so it is imported
// only in development; production writes one JSON object per line to stdout for Docker to collect. The request line's
// `request` details repeat its message, so development leaves them out.
const prettyStream =
  env.NODE_ENV === "development"
    ? (await import("pino-pretty")).default({ ignore: "pid,hostname,request", singleLine: true })
    : undefined;

/*===== Logger =====*/
/**
 * The server's one logger.
 *
 * Log errors under the `err` key: `log.error({ err, errorId }, "message")`. Every such line at `error` level or above
 * is also sent to the error tracker (`app/lib/error-reporting.server.ts`), so app code never reports errors itself.
 * Lines written while a request is handled carry its `reqId`.
 */
export const logger = pino(
  {
    level: env.LOG_LEVEL,
    serializers: { err: serializeError },
    mixin: () => {
      const id = currentTrace()?.id;
      return id ? { reqId: id } : {};
    },
    hooks: {
      logMethod(args, method, level) {
        // pino only calls this hook for enabled levels, so `LOG_LEVEL=fatal` or `silent` also stops error reports.
        const [first, second] = args as unknown[];
        if (level >= pino.levels.values.error && typeof first === "object" && first !== null && "err" in first) {
          const { err, ...fields } = first as Record<string, unknown>;
          reportError({
            err,
            message: typeof second === "string" ? second : undefined,
            fields: { ...this.bindings(), ...fields },
          });
        }
        method.apply(this, args);
      },
    },
  },
  prettyStream,
);

/** A child logger that tags every line with the module it came from, e.g. `createLogger("media")`. */
export function createLogger(module: string) {
  return logger.child({ module });
}
