import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { Db } from "#/server/db.server";
import { appRuntime } from "#/server/runtime.server";

/** Longer than a healthy query ever takes, shorter than the container healthcheck's own timeout. */
const DB_TIMEOUT = "2 seconds";

/*===== Health Check =====*/
/**
 * 200 when the app can query Postgres within `DB_TIMEOUT`, 503 otherwise. A failure is logged, and reported to the
 * error viewer.
 *
 * Storage isn't checked: an S3 outage only breaks uploads, and restarting the app wouldn't fix it.
 */
const checkHealth = Effect.gen(function* () {
  const { q } = yield* Db;
  yield* q.execute(sql`select 1`);
}).pipe(
  Effect.timeout(DB_TIMEOUT),
  Effect.as(true),
  Effect.catchCause((cause) =>
    Effect.logError("database unreachable", cause).pipe(Effect.annotateLogs({ module: "health" }), Effect.as(false)),
  ),
);

/**
 * `GET /healthz`: Docker's healthcheck and uptime monitors poll it. The request log skips healthy probes
 * (`#/server/observability/http.server`), so only failures and slow checks are written.
 */
async function handleGet() {
  const healthy = await appRuntime.runPromise(checkHealth);
  return Response.json(
    { status: healthy ? "ok" : "error" },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

/*===== Route =====*/
export const Route = createFileRoute("/healthz")({
  server: { handlers: { GET: handleGet } },
});
