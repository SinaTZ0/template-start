import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer } from "effect";
import { isSqlError } from "effect/sql/SqlError";

import { AppConfig } from "#/server/config.server";

/*===== Connection Pool =====*/
/**
 * The app's Postgres pool, as both `PgClient` and Effect's generic `SqlClient`. Drizzle (`Db`) and the job queue's
 * store (`#/server/jobs.server`) share it, which is what lets a job be queued inside a `Db.transaction`.
 *
 * Without the timeouts, a stalled Postgres would hang every request instead of failing it.
 */
export const PgLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    return PgClient.layer({
      url: config.databaseUrl,
      // Named in `pg_stat_activity`, so the app's connections can be told from the auth pool's and tools'.
      applicationName: "app",
      maxConnections: 10,
      // How long a query waits for Postgres to answer the connection, and for a free one when all ten are busy.
      connectTimeout: "5 seconds",
      acquireTimeout: "5 seconds",
      startupParameters: {
        // Far above any query the app runs. Postgres cancels a statement that takes longer, which frees its connection.
        statement_timeout: "30000",
        // A transaction left open (an interrupted fiber that never reached its rollback) would hold its locks.
        idle_in_transaction_session_timeout: "60000",
      },
    });
  }),
);

/*===== Database =====*/
type Drizzle = Effect.Success<ReturnType<typeof PgDrizzle.makeWithDefaults>>;

/**
 * The app's database: Drizzle's Effect client on Effect's own Postgres driver (`@effect/sql-pg`).
 *
 * - **Queries are Effects.** `yield* db.select().from(note)` runs the query; it fails with Drizzle's
 *   `EffectDrizzleQueryError`. Repositories end every method in `Effect.orDie`: a failed query is a defect, reported at
 *   the boundary, never a domain error.
 * - **Transactions are ambient.** `transaction(effect)` runs `effect` in one transaction, and every query inside it, in
 *   any repository, joins that transaction through the fiber's context: nothing passes a `tx` down. A failure or
 *   defect rolls it back; a typed failure keeps its type.
 * - **Spans.** Each statement is a span carrying its SQL (`db.query.text`), never its parameters.
 */
export class Db extends Context.Service<
  Db,
  {
    readonly q: Drizzle;
    readonly transaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  }
>()("app/server/Db") {
  static readonly layer = Layer.effect(
    Db,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const q = yield* PgDrizzle.makeWithDefaults({ paramsInErrors: config.logQueryParams });
      return Db.of({
        q,
        // Failing to begin or commit is the database failing, not the work: a defect like a failed query.
        transaction: (effect) =>
          q.transaction(() => effect).pipe(Effect.catchIf(isSqlError, (error) => Effect.die(error))),
      });
    }),
  );
}
