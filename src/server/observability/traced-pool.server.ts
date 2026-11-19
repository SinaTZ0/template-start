import { performance } from "node:perf_hooks";

import type { Pool, PoolClient } from "pg";

import { env } from "#/env.server";
import { createLogger } from "#/lib/logger.server";
import { currentSpanId, currentTrace, recordSpan } from "#/lib/trace.server";
import { sqlText } from "#/server/observability/sql-text";

const log = createLogger("db");

/*===== Query Tracing =====*/
type QueryFunction = (...args: unknown[]) => unknown;

/** Wraps `query` so every call becomes a `db` span of the current request, and a slow one is logged on its own. */
function traceQuery(query: QueryFunction): QueryFunction {
  return (...args) => {
    // Taken at call time, when Drizzle is still running in the request's async context.
    const trace = currentTrace();
    const parent = currentSpanId();
    const start = performance.now();
    const result = query(...args);

    // Only the promise form is timed: Drizzle never passes a callback. The handlers only observe; the caller still gets
    // (and handles) the original promise.
    if (result instanceof Promise) {
      const finish = (failed: boolean) => {
        const sql = sqlText(args[0]);
        const ms = recordSpan({ trace, parent, kind: "db", name: sql, start, failed });
        if (ms >= env.LOG_SLOW_QUERY_MS) log.warn({ sql, ms: Math.round(ms) }, "slow query");
      };
      result.then(
        () => finish(false),
        () => finish(true),
      );
    }
    return result;
  };
}

/**
 * A view of `target` whose `query` is traced. A proxy rather than a patched method: pg calls its own clients
 * internally, and only the calls Drizzle makes should be counted, once each.
 */
function withTracedQuery<T extends object>(target: T, overrides: Record<string, unknown> = {}): T {
  const query = traceQuery((target as { query: QueryFunction }).query.bind(target));
  return new Proxy(target, {
    get(object, key) {
      if (key === "query") return query;
      if (typeof key === "string" && key in overrides) return overrides[key];
      const value: unknown = Reflect.get(object, key, object);
      return typeof value === "function" ? (value as QueryFunction).bind(object) : value;
    },
  });
}

/**
 * Traces the pool's queries, and those on the clients it checks out for transactions: each is a `db` span of the current
 * request, and a slow one is logged on its own. For the one pool outside Effect, Better-Auth's (`#/server/auth.server`).
 */
export function tracePool(pool: Pool): Pool {
  const connect = (...args: unknown[]) =>
    args.length > 0
      ? (pool.connect as QueryFunction)(...args)
      : pool.connect().then((client: PoolClient) => withTracedQuery(client));
  return withTracedQuery(pool, { connect });
}
