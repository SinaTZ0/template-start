import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { Database } from "#/db/client.server";
import { createLogger } from "#/lib/logger.server";
import { deleteObjects, mediaKey, putObject } from "#/lib/storage.server";
import { span } from "#/lib/trace.server";
import type { UserRole } from "#/lib/user-constants";
import { MEDIA_UPLOAD_KINDS_BY_ROLE, MEDIA_VARIANTS } from "#/orpc/media/constants";
import type { MediaKind } from "#/orpc/media/constants";
import type { Media } from "#/orpc/media/contract";
import { isMediaKind, toPublicMedia } from "#/orpc/media/mapper";
import { processImage } from "#/orpc/media/processing.server";
import { m } from "#/paraglide/messages";
import {
  claimMedia,
  countUnattachedMedia,
  deleteMediaRow,
  findMediaById,
  findOrphanedMediaIds,
  insertMedia,
  markMediaDetached,
} from "#/orpc/media/repository";

const log = createLogger("media");

/*===== Lifetimes =====*/
/** How long an upload can still be attached: a form must be saved within this time of picking its image. */
export const MEDIA_ATTACH_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How old an unattached upload must be before the cleanup deletes it. The hour past the attach window means the cleanup
 * never races a save: by the time a media qualifies, `attachMedia` has refused it for an hour.
 */
export const ORPHANED_MEDIA_AGE_MS = MEDIA_ATTACH_WINDOW_MS + 60 * 60 * 1000;

/*===== Quota =====*/
/**
 * How many uploads one user may have waiting to be attached. Far more than open forms ever hold, and it bounds what an
 * account can park in the bucket: unattached uploads live for `ORPHANED_MEDIA_AGE_MS` before the cleanup deletes them.
 */
export const MAX_UNATTACHED_MEDIA_PER_USER = 30;

/*===== Keys =====*/
function variantKeys({ kind, mediaId }: { kind: MediaKind; mediaId: string }): string[] {
  return Object.keys(MEDIA_VARIANTS[kind]).map((variant) => mediaKey({ kind, mediaId, variant }));
}

/*===== Upload =====*/
type UploadMediaResult =
  { kind: "success"; media: Media } | { kind: "forbidden" } | { kind: "invalid"; fields: Record<string, string> };

/**
 * Processes an image and stores it: every variant goes to the bucket first and the row is inserted last, so a row only
 * exists when all its variants do.
 *
 * Nothing attaches the media to anything yet; the entity that uses it calls `attachMedia` when its form is saved.
 *
 * @returns `forbidden` when the role doesn't use this kind of image, `invalid` with a `file` message when the image is
 * rejected or the user already has `MAX_UNATTACHED_MEDIA_PER_USER` uploads waiting to be attached.
 * @throws When the bucket or the database fails. Variants already written are deleted first.
 */
export async function uploadMedia({
  db,
  user,
  kind,
  file,
}: {
  db: Database;
  user: { id: string; role: UserRole };
  kind: MediaKind;
  file: File;
}): Promise<UploadMediaResult> {
  if (!MEDIA_UPLOAD_KINDS_BY_ROLE[user.role]?.includes(kind)) return { kind: "forbidden" };

  // Before the image is decoded, so an account at its quota costs one count query. Two uploads racing past the last
  // free place overshoot by one, which the quota can afford.
  const waiting = await countUnattachedMedia({ db, userId: user.id });
  if (waiting >= MAX_UNATTACHED_MEDIA_PER_USER) {
    return { kind: "invalid", fields: { file: m.media_error_too_many_waiting() } };
  }

  // Resizing and encoding is CPU work no other span covers.
  const processed = await span({ kind: "task", name: "media.processImage" }, () => processImage({ file, kind }));
  if (processed.kind === "invalid") return { kind: "invalid", fields: { file: processed.message } };
  const { image } = processed;

  const mediaId = randomUUID();
  const keys = variantKeys({ kind, mediaId });

  try {
    /*------ Variants ------*/
    // Every write is awaited before anything is cleaned up, so no write can land after the cleanup and be left behind.
    const writes = await Promise.allSettled(
      image.variants.map((variant) =>
        putObject({
          key: mediaKey({ kind, mediaId, variant: variant.name }),
          body: variant.body,
          contentType: "image/webp",
        }),
      ),
    );
    const failed = writes.find((write) => write.status === "rejected");
    if (failed) throw failed.reason;

    /*------ Row ------*/
    const record = await insertMedia({
      db,
      values: {
        id: mediaId,
        kind,
        uploadedBy: user.id,
        width: image.width,
        height: image.height,
        placeholder: image.placeholder,
      },
    });

    return { kind: "success", media: toPublicMedia(record) };
  } catch (error) {
    // Deleting a key that was never written is fine, so all of them are removed. A failing cleanup must not hide the
    // original error.
    await deleteObjects({ keys }).catch((cleanupError: unknown) =>
      log.error({ err: cleanupError, mediaId }, "could not clean up the variants"),
    );
    throw error;
  }
}

/*===== Attach =====*/
const mediaIdSchema = z.guid();

/** Whether the text can be a media ID. A malformed one would make Postgres throw, so callers treat it as unknown. */
export function isMediaId(value: string): boolean {
  return mediaIdSchema.safeParse(value).success;
}

type AttachMediaResult = { kind: "ok" } | { kind: "invalid" };

/**
 * Claims an upload for the entity being saved, so the cleanup job leaves it alone. Call it with the transaction that
 * writes the entity: if that write fails, the claim is rolled back with it and the cleanup still finds the upload.
 *
 * A media belongs to one entity, so one that is already attached is refused: two entities sharing an image would lose
 * it together when either is deleted. An entity whose image didn't change doesn't attach it again.
 *
 * @returns `invalid` when the ID is unknown or malformed, the media is another kind, someone else uploaded it, it is
 * already attached, or it is still unattached past `MEDIA_ATTACH_WINDOW_MS` (the cleanup is about to delete it).
 */
export async function attachMedia({
  db,
  mediaId,
  kind,
  userId,
  now = new Date(),
}: {
  db: Database;
  mediaId: string;
  kind: MediaKind;
  userId: string;
  now?: Date;
}): Promise<AttachMediaResult> {
  if (!isMediaId(mediaId)) return { kind: "invalid" };

  const record = await findMediaById({ db, id: mediaId });
  if (!record || !isMediaKind(record.kind) || record.kind !== kind || record.uploadedBy !== userId) {
    return { kind: "invalid" };
  }

  if (record.attachedAt) return { kind: "invalid" };
  if (now.getTime() - record.createdAt.getTime() > MEDIA_ATTACH_WINDOW_MS) return { kind: "invalid" };

  // Checked again by the update itself: another save may have claimed it since the read.
  const claimed = await claimMedia({ db, id: mediaId });
  return claimed ? { kind: "ok" } : { kind: "invalid" };
}

/*===== Release =====*/
/**
 * Lets go of a media its entity no longer uses: the entity was deleted, or its image replaced. Call it with the
 * transaction that changes the entity, then `discardMedia` once that transaction has committed.
 */
export async function releaseMedia({ db, mediaId }: { db: Database; mediaId: string }): Promise<void> {
  if (!isMediaId(mediaId)) return;
  await markMediaDetached({ db, id: mediaId });
}

/**
 * Deletes a released media right away rather than waiting for the cleanup. A failure is logged, not thrown: the entity
 * is already saved without it, and the media is unattached, so the cleanup deletes it on a later run.
 */
export async function discardMedia({ db, mediaId }: { db: Database; mediaId: string }): Promise<void> {
  try {
    await deleteMedia({ db, mediaId });
  } catch (error) {
    log.error({ err: error, mediaId }, "could not delete a released media; the cleanup will retry");
  }
}

/*===== Delete =====*/
/**
 * Deletes every variant from the bucket, then the row. A media that is already gone is a no-op.
 *
 * The bucket goes first: if it fails, the row stays and the delete can be retried; the other order could leave files
 * nothing points to. Entities still pointing at the row are cleared by the foreign key.
 *
 * @throws When the bucket or the database fails.
 */
export async function deleteMedia({ db, mediaId }: { db: Database; mediaId: string }): Promise<void> {
  if (!isMediaId(mediaId)) return;

  const record = await findMediaById({ db, id: mediaId });
  if (!record) return;

  // A row of an unknown kind can't be mapped to keys; leave it for a person to look at instead of guessing.
  if (!isMediaKind(record.kind)) throw new Error(`Media ${record.id} has an unknown kind: ${record.kind}`);

  await deleteObjects({ keys: variantKeys({ kind: record.kind, mediaId }) });
  await deleteMediaRow({ db, id: mediaId });
}

/*===== Orphan Cleanup =====*/
const ORPHAN_BATCH_SIZE = 200;
/** Ends a run that keeps finding work, so one pass never occupies the process for hours. The next run goes on. */
const ORPHAN_MAX_BATCHES = 50;

/**
 * Deletes the uploads that were never attached (forms that were never saved) and are older than
 * `ORPHANED_MEDIA_AGE_MS`, a batch at a time until none are left. Run on a schedule (`cleanup.server.ts`).
 *
 * A media that fails to delete is logged and skipped, so one broken row can't block the rest. It stays unattached and
 * is retried on the next run.
 *
 * @returns How many were deleted and how many failed.
 */
export async function deleteOrphanedMedia({
  db,
  now = new Date(),
}: {
  db: Database;
  now?: Date;
}): Promise<{ deleted: number; failed: number }> {
  const uploadedBefore = new Date(now.getTime() - ORPHANED_MEDIA_AGE_MS);
  // Skipped in later batches: a media that failed is still unattached, so the query returns it again.
  const failedIds = new Set<string>();
  let deleted = 0;

  for (let batch = 0; batch < ORPHAN_MAX_BATCHES; batch++) {
    const ids = await findOrphanedMediaIds({ db, uploadedBefore, limit: ORPHAN_BATCH_SIZE });
    const pending = ids.filter((id) => !failedIds.has(id));
    // Nothing new: the backlog is empty, or the oldest batch is all failures and the next run retries them.
    if (pending.length === 0) break;

    // One at a time: the job runs in the app's process and shouldn't compete with requests for the pool or the bucket.
    for (const mediaId of pending) {
      try {
        await deleteMedia({ db, mediaId });
        deleted += 1;
      } catch (error) {
        failedIds.add(mediaId);
        log.error({ err: error, mediaId }, "could not delete an orphaned media");
      }
    }

    if (ids.length < ORPHAN_BATCH_SIZE) break;
  }
  return { deleted, failed: failedIds.size };
}
