import { Clock, Effect, Option, Schema } from "effect";

import { ORPHANED_MEDIA_AGE_MS } from "#/orpc/media/constants";
import { isMediaId, isMediaKind, variantKeys } from "#/orpc/media/mapper";
import { MediaRepo } from "#/orpc/media/repository";
import { defineJob } from "#/server/jobs.server";
import { Storage } from "#/server/storage.server";

/*===== Media Jobs =====*/
// The template's two worked examples of a job (docs/backend/jobs.md): one queued by a request, one on a schedule.
// Deleting media happens only here, so the deletion lives here too, beside the jobs that run it.

/**
 * Deletes every variant from the bucket, then the row. A media that is already gone is a no-op.
 *
 * The bucket goes first: if it fails, the row stays and the delete can be retried; the other order could leave files
 * nothing points to. Entities still pointing at the row are cleared by the foreign key.
 */
const deleteMedia = Effect.fn("MediaJobs.deleteMedia")(function* (mediaId: string) {
  const repo = yield* MediaRepo;
  const found = yield* repo.findById(mediaId);
  if (Option.isNone(found)) return;
  const record = found.value;

  // A row of an unknown kind can't be mapped to keys; leave it for a person to look at instead of guessing.
  if (!isMediaKind(record.kind)) {
    return yield* Effect.die(new Error(`Media ${record.id} has an unknown kind: ${record.kind}`));
  }

  yield* (yield* Storage).deleteMany(variantKeys({ kind: record.kind, mediaId }));
  yield* repo.delete(mediaId);
});

/*===== Discard =====*/
/**
 * Deletes the files and the row of a media its entity let go of, unless something attached it again since. Queued by
 * `MediaService.release`, so the request never waits on the bucket, and a bucket that's down is retried instead of
 * leaving the files for the hourly cleanup.
 */
export const DiscardMedia = defineJob({
  name: "media.discard",
  payload: Schema.Struct({ mediaId: Schema.String }),
  run: Effect.fn("MediaJobs.discard")(function* ({ mediaId }: { readonly mediaId: string }) {
    if (!isMediaId(mediaId)) return;
    const found = yield* (yield* MediaRepo).findById(mediaId);
    if (Option.isNone(found) || found.value.attachedAt) return;
    yield* deleteMedia(mediaId);
  }),
});

/*===== Orphan Cleanup =====*/
const ORPHAN_BATCH_SIZE = 200;
/** Ends a run that keeps finding work, so one pass never occupies the process for hours. The next run goes on. */
const ORPHAN_MAX_BATCHES = 50;

/**
 * Deletes the uploads that were never attached (forms that were never saved) and are older than
 * `ORPHANED_MEDIA_AGE_MS`, a batch at a time until none are left.
 *
 * A media that fails to delete is reported and skipped, so one broken row can't block the rest. It stays unattached and
 * is retried on the next run.
 *
 * @returns How many were deleted and how many failed.
 */
export const deleteOrphanedMedia = Effect.fn("MediaJobs.deleteOrphaned")(function* () {
  const repo = yield* MediaRepo;
  const uploadedBefore = new Date((yield* Clock.currentTimeMillis) - ORPHANED_MEDIA_AGE_MS);
  // Skipped in later batches: a media that failed is still unattached, so the query returns it again.
  const failedIds = new Set<string>();
  let deleted = 0;

  for (let batch = 0; batch < ORPHAN_MAX_BATCHES; batch++) {
    const ids = yield* repo.findOrphanedIds({ uploadedBefore, limit: ORPHAN_BATCH_SIZE });
    const pending = ids.filter((id) => !failedIds.has(id));
    // Nothing new: the backlog is empty, or the oldest batch is all failures and the next run retries them.
    if (pending.length === 0) break;

    // One at a time: the job runs in the app's process and shouldn't compete with requests for the pool or the bucket.
    for (const mediaId of pending) {
      yield* deleteMedia(mediaId).pipe(
        Effect.tap(() => Effect.sync(() => deleted++)),
        Effect.catchCause((cause) => {
          failedIds.add(mediaId);
          return Effect.logError("could not delete an orphaned media", cause).pipe(Effect.annotateLogs({ mediaId }));
        }),
      );
    }

    if (ids.length < ORPHAN_BATCH_SIZE) break;
  }
  return { deleted, failed: failedIds.size };
});

/** Deletes the uploads that were never attached, every hour (docs/backend/media.md → Cleanup). */
export const CleanupMedia = defineJob({
  name: "media.cleanup",
  payload: Schema.Struct({}),
  cron: "0 * * * *",
  // The next hour's run goes over the same uploads, so a failed run isn't worth repeating.
  maxAttempts: 1,
  run: () =>
    deleteOrphanedMedia().pipe(
      Effect.tap(({ deleted, failed }) =>
        deleted > 0 || failed > 0
          ? Effect.logInfo("deleted orphaned media").pipe(Effect.annotateLogs({ deleted, failed }))
          : Effect.void,
      ),
    ),
});
