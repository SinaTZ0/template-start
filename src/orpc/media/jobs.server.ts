import { z } from "zod";

import { db as appDb } from "#/db/client.server";
import { defineJob } from "#/lib/jobs.server";
import { createLogger } from "#/lib/logger.server";
import type { Database } from "#/db/client.server";
import { markMediaDetached } from "#/orpc/media/repository";
import { deleteOrphanedMedia, deleteReleasedMedia, isMediaId } from "#/orpc/media/service";

const log = createLogger("media-jobs");

/*===== Media Jobs =====*/
// The template's two worked examples of a job (docs/backend/jobs.md): one queued by a request, one on a schedule.

/**
 * Deletes the files and the row of a media its entity let go of. Queued by `releaseMedia`, so the request never waits
 * on the bucket, and a bucket that's down is retried instead of leaving the files for the hourly cleanup.
 */
export const discardMediaJob = defineJob({
  name: "media.discard",
  schema: z.object({ mediaId: z.guid() }),
  run: ({ mediaId }) => deleteReleasedMedia({ db: appDb, mediaId }),
});

/**
 * Lets go of a media its entity no longer uses: the entity was deleted, or its image replaced. Call it with the
 * transaction that changes the entity. The media is marked unattached and its deletion is queued in that same
 * transaction, so both happen if it commits and neither if it rolls back.
 */
export async function releaseMedia({ db, mediaId }: { db: Database; mediaId: string }): Promise<void> {
  if (!isMediaId(mediaId)) return;
  await markMediaDetached({ db, id: mediaId });
  await discardMediaJob.enqueue({ data: { mediaId }, db });
}

/** Deletes the uploads that were never attached, every hour (docs/backend/media.md → Cleanup). */
export const cleanupMediaJob = defineJob({
  name: "media.cleanup",
  schema: z.object({}),
  cron: "0 * * * *",
  // The next hour's run goes over the same uploads, so a failed run isn't worth repeating.
  retryLimit: 0,
  expireInSeconds: 30 * 60,
  run: async () => {
    const { deleted, failed } = await deleteOrphanedMedia({ db: appDb });
    if (deleted > 0 || failed > 0) log.info({ deleted, failed }, "deleted orphaned media");
  },
});
