import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { Database } from "~/db/client.server";
import { createLogger } from "~/lib/logger.server";
import { deleteObjects, mediaKey, putObject } from "~/lib/storage.server";
import { span } from "~/lib/trace.server";
import type { UserRole } from "~/lib/user-constants";
import { MEDIA_UPLOAD_KINDS_BY_ROLE, MEDIA_VARIANTS } from "~/orpc/media/constants";
import type { MediaKind } from "~/orpc/media/constants";
import type { Media } from "~/orpc/media/contract";
import { isMediaKind, toPublicMedia } from "~/orpc/media/mapper";
import { processImage } from "~/orpc/media/processing.server";
import { deleteMediaRow, findMediaById, insertMedia, markMediaAttached } from "~/orpc/media/repository";

const log = createLogger("media");

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
 * rejected.
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
 * Marks a media row as used by an entity, so the cleanup job leaves it alone. Call it when the entity's form is saved.
 *
 * Calling it again for a media that is already attached is fine, which keeps re-saving a form idempotent. It cannot
 * tell which entity uses the media: an entity that must not share one checks that itself.
 *
 * @returns `invalid` when the ID is unknown or malformed, the media is another kind, or someone else uploaded it.
 */
export async function attachMedia({
  db,
  mediaId,
  kind,
  userId,
}: {
  db: Database;
  mediaId: string;
  kind: MediaKind;
  userId: string;
}): Promise<AttachMediaResult> {
  if (!isMediaId(mediaId)) return { kind: "invalid" };

  const record = await findMediaById({ db, id: mediaId });
  if (!record || !isMediaKind(record.kind) || record.kind !== kind || record.uploadedBy !== userId) {
    return { kind: "invalid" };
  }

  await markMediaAttached({ db, id: mediaId });
  return { kind: "ok" };
}

/*===== Delete =====*/
/**
 * Deletes every variant from the bucket, then the row. A media that is already gone is a no-op.
 *
 * The bucket goes first: if it fails, the row stays and the delete can be retried; the other order could leave files
 * nothing points to. Entities still pointing at the row are cleared by the foreign key.
 *
 * Not scheduled anywhere yet: a project that needs it adds a job that calls this for media still unattached 24 hours
 * after `created_at` (forms that were never saved). Until then those files stay in the bucket.
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
