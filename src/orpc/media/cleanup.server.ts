import { db } from "#/db/client.server";
import { createLogger } from "#/lib/logger.server";
import { deleteOrphanedMedia } from "#/orpc/media/service";

const log = createLogger("media-cleanup");

/*===== Schedule =====*/
const FIRST_RUN_DELAY_MS = 60 * 1000;
const RUN_INTERVAL_MS = 60 * 60 * 1000;

// Vite re-evaluates server modules on every change in development; the flag lives on `globalThis` so each edit doesn't
// start another timer.
const STARTED = Symbol.for("app.mediaCleanup.started");
const state = globalThis as typeof globalThis & { [STARTED]?: boolean };

let running = false;

/** One cleanup pass. Skipped while the previous one is still going, e.g. when the bucket is slow. */
async function runCleanup(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { deleted, failed } = await deleteOrphanedMedia({ db });
    if (deleted > 0 || failed > 0) log.info({ deleted, failed }, "deleted orphaned media");
  } catch (error) {
    log.error({ err: error }, "media cleanup failed");
  } finally {
    running = false;
  }
}

/**
 * Deletes uploads that were never attached, hourly, inside the app's process (docs/backend/media.md → Cleanup). That
 * fits the single app process `compose.prod.yaml` runs; with several, each would run it, which is wasteful but safe
 * because deleting a media twice is a no-op.
 *
 * The first pass waits a minute, so a restart doesn't add bucket work to startup. Timers are `unref`ed and never keep
 * the process alive.
 */
export function startMediaCleanup(): void {
  if (state[STARTED]) return;
  state[STARTED] = true;

  setTimeout(() => void runCleanup(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runCleanup(), RUN_INTERVAL_MS).unref();
}
