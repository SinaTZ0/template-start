import { z } from "zod";

import type { Database } from "#/db/client.server";
import { issuesToErrorData } from "#/lib/schema-issues";
import { attachMedia, discardMedia, releaseMedia } from "#/orpc/media/service";
import { findMediaById } from "#/orpc/media/repository";
import type { Note } from "#/orpc/note/contract";
import { toPublicNote } from "#/orpc/note/mapper";
import { deleteNoteRow, findNotesByOwner, findOwnedNote, insertNote } from "#/orpc/note/repository";
import { newNoteSchema } from "#/orpc/note/validation";
import { m } from "#/paraglide/messages";

/*===== List =====*/
/** Returns the owner's notes, newest first. */
export async function listNotes({ db, ownerId }: { db: Database; ownerId: string }): Promise<Note[]> {
  const rows = await findNotesByOwner({ db, ownerId });
  return rows.map(toPublicNote);
}

/*===== Add =====*/
type AddNoteResult = { kind: "success"; note: Note } | { kind: "invalid"; fields: Record<string, string> };

/**
 * Validates and stores a new note for its owner. An image must be an `image` upload by the same user that no other
 * entity uses; it is marked attached so the orphan cleanup leaves it alone.
 *
 * @returns `invalid` with per-field messages when the input breaks a domain rule.
 */
export async function addNote({
  db,
  ownerId,
  input,
}: {
  db: Database;
  ownerId: string;
  input: unknown;
}): Promise<AddNoteResult> {
  const parsed = newNoteSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid", fields: issuesToErrorData(parsed.error.issues).fields };
  const { title, body, imageMediaId } = parsed.data;

  // One transaction: if the insert fails, the image's claim is rolled back too, and the cleanup still finds it.
  return db.transaction(async (tx): Promise<AddNoteResult> => {
    /*------ Image ------*/
    if (imageMediaId) {
      const attached = await attachMedia({ db: tx, mediaId: imageMediaId, kind: "image", userId: ownerId });
      if (attached.kind === "invalid") {
        return { kind: "invalid", fields: { imageMediaId: m.note_error_image_unusable() } };
      }
    }

    /*------ Row ------*/
    const record = await insertNote({ db: tx, values: { ownerId, title, body, imageMediaId } });
    const image = imageMediaId ? ((await findMediaById({ db: tx, id: imageMediaId })) ?? null) : null;
    return { kind: "success", note: toPublicNote({ note: record, image }) };
  });
}

/*===== Remove =====*/
type RemoveNoteResult = { kind: "ok" } | { kind: "not-found" };

/**
 * Deletes one of the owner's notes, then its image. The note's row and the image's release are one transaction, so the
 * image is never left attached to nothing. Its files are deleted after that commits; if the bucket fails, the image is
 * unattached and the cleanup deletes it later (docs/backend/media.md).
 *
 * @returns `not-found` for an unknown ID or another user's note.
 */
export async function removeNote({
  db,
  ownerId,
  id,
}: {
  db: Database;
  ownerId: string;
  id: string;
}): Promise<RemoveNoteResult> {
  // A malformed UUID would make Postgres throw; treat it like any unknown ID.
  if (!z.guid().safeParse(id).success) return { kind: "not-found" };

  const record = await db.transaction(async (tx) => {
    const owned = await findOwnedNote({ db: tx, id, ownerId });
    if (!owned) return undefined;
    await deleteNoteRow({ db: tx, id: owned.id });
    if (owned.imageMediaId) await releaseMedia({ db: tx, mediaId: owned.imageMediaId });
    return owned;
  });
  if (!record) return { kind: "not-found" };

  if (record.imageMediaId) await discardMedia({ db, mediaId: record.imageMediaId });
  return { kind: "ok" };
}
