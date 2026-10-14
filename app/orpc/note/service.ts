import { z } from "zod";

import type { Database } from "~/db/client.server";
import { issuesToErrorData } from "~/lib/schema-issues";
import { attachMedia, deleteMedia } from "~/orpc/media/service";
import { findMediaById } from "~/orpc/media/repository";
import type { Note } from "~/orpc/note/contract";
import { toPublicNote } from "~/orpc/note/mapper";
import { deleteNoteRow, findNotesByOwner, findOwnedNote, insertNote } from "~/orpc/note/repository";
import { newNoteSchema } from "~/orpc/note/validation";

/*===== List =====*/
/** Returns the owner's notes, newest first. */
export async function listNotes({ db, ownerId }: { db: Database; ownerId: string }): Promise<Note[]> {
  const rows = await findNotesByOwner({ db, ownerId });
  return rows.map(toPublicNote);
}

/*===== Add =====*/
type AddNoteResult = { kind: "success"; note: Note } | { kind: "invalid"; fields: Record<string, string> };

/**
 * Validates and stores a new note for its owner. An image must be an `image` upload by the same user; it is marked
 * attached so a cleanup job leaves it alone.
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

  /*------ Image ------*/
  if (imageMediaId) {
    const attached = await attachMedia({ db, mediaId: imageMediaId, kind: "image", userId: ownerId });
    if (attached.kind === "invalid") return { kind: "invalid", fields: { imageMediaId: "این عکس قابل استفاده نیست." } };
  }

  /*------ Row ------*/
  const record = await insertNote({ db, values: { ownerId, title, body, imageMediaId } });
  const image = imageMediaId ? ((await findMediaById({ db, id: imageMediaId })) ?? null) : null;
  return { kind: "success", note: toPublicNote({ note: record, image }) };
}

/*===== Remove =====*/
type RemoveNoteResult = { kind: "ok" } | { kind: "not-found" };

/**
 * Deletes one of the owner's notes, then its image (bucket files and row). The note goes first, so a failing bucket
 * leaves an orphan image rather than a note pointing at missing files.
 *
 * @returns `not-found` for an unknown ID or another user's note.
 * @throws When the bucket or the database fails while deleting the image.
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

  const record = await findOwnedNote({ db, id, ownerId });
  if (!record) return { kind: "not-found" };

  await deleteNoteRow({ db, id: record.id });
  if (record.imageMediaId) await deleteMedia({ db, mediaId: record.imageMediaId });
  return { kind: "ok" };
}
