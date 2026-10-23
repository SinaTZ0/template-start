import { performance } from "node:perf_hooks";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PoolClient } from "pg";

import { env } from "#/env.server";
import * as schema from "#/db/schema";
import { createLogger } from "#/lib/logger.server";
import { currentSpanId, currentTrace, recordSpan } from "#/lib/trace.server";

const log = createLogger("db");

/*===== Query Tracing =====*/
const MAX_SQL_LENGTH = 300;

type QueryFunction = (...args: unknown[]) => unknown;

/**
 * The query's shape, short enough to read in a timeline: identifier quotes and column lists are dropped, the tables,
 * joins and conditions stay. `select "note"."id", … from "note" where "note"."owner_id" = $1` becomes
 * `select … from note where note.owner_id = $1`. Parameters are never included.
 */
function sqlText(input: unknown): string {
  const text = typeof input === "string" ? input : (input as { text?: unknown } | null)?.text;
  if (typeof text !== "string") return "(unknown query)";
  const short = text
    .replace(/\s+/g, " ")
    .replaceAll('"', "")
    // The first `from` ends the column list. A subquery in it would end the list early, which still reads fine.
    .replace(/^select (distinct )?.+? from /i, "select $1… from ")
    .replace(/ returning .+$/i, " returning …")
    .replace(/^insert into (\S+) \(.+?\) values .+?( on conflict| returning|$)/i, "insert into $1 …$2")
    .replace(/ set .+? where /i, " set … where ")
    .trim();
  return short.length > MAX_SQL_LENGTH ? `${short.slice(0, MAX_SQL_LENGTH)}…` : short;
}

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

/** Traces the pool's queries, and those on the clients it checks out for transactions. */
function tracePool(pool: Pool): Pool {
  const connect = (...args: unknown[]) =>
    args.length > 0
      ? (pool.connect as QueryFunction)(...args)
      : pool.connect().then((client: PoolClient) => withTracedQuery(client));
  return withTracedQuery(pool, { connect });
}

/*===== Client =====*/
/**
 * Shared Drizzle client backed by a node-postgres connection pool. Every query is timed into the current request's
 * trace (`#/lib/trace.server`).
 *
 * Server-only: create one per process and pass it to repositories through their
 * dependency object rather than importing it there directly.
 */
export const db = drizzle({
  client: tracePool(new Pool({ connectionString: env.DATABASE_URL })),
  schema,
});

export type Database = typeof db;
