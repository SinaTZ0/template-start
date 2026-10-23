import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { db } from "#/db/client.server";
import { createLogger } from "#/lib/logger.server";

const log = createLogger("health");

/** Longer than a healthy query ever takes, shorter than the container healthcheck's own timeout. */
const DB_TIMEOUT_MS = 2_000;

/*===== Health Check =====*/
/**
 * `GET /healthz`: 200 when the app can query Postgres, 503 otherwise. Docker's healthcheck and uptime monitors poll it.
 *
 * Storage isn't checked: an S3 outage only breaks uploads, and restarting the app wouldn't fix it. The request log
 * skips healthy probes (`src/lib/request-log.server.ts`), so only failures and slow checks are written.
 */
async function handleGet() {
  const headers = { "Cache-Control": "no-store" };

  try {
    // pg waits for a connection with no time limit by default, so an unreachable database would hang the probe.
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`No answer within ${DB_TIMEOUT_MS} ms`)), DB_TIMEOUT_MS),
      ),
    ]);
    return Response.json({ status: "ok" }, { headers });
  } catch (error) {
    log.error({ err: error }, "database unreachable");
    return Response.json({ status: "error" }, { status: 503, headers });
  }
}

/*===== Route =====*/
export const Route = createFileRoute("/healthz")({
  server: { handlers: { GET: handleGet } },
});
