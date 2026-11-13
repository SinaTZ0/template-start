import { z } from "zod";

import type { Database } from "#/db/client.server";
import { issuesToErrorData } from "#/lib/schema-issues";
import { attachMedia, discardMedia, releaseMedia } from "#/orpc/media/service";
import { findMediaById } from "#/orpc/media/repository";
import { NOTE_PAGE_SIZE } from "#/orpc/note/constants";
import type { Note, NotePage, NoteStats } from "#/orpc/note/contract";
import { toPublicNote } from "#/orpc/note/mapper";
import {
  countNotes,
  deleteNoteRow,
  findNotesByOwner,
  findOwnedNote,
  insertNote,
  lockOwnedNote,
  updateNoteRow,
} from "#/orpc/note/repository";
import type { NotePosition } from "#/orpc/note/repository";
import { noteFieldsSchema } from "#/orpc/note/validation";
import { m } from "#/paraglide/messages";

/** A malformed UUID would make Postgres throw, so an ID is checked before it reaches a query. */
const noteIdSchema = z.guid();

/*===== List =====*/
// A cursor is the last note's place in the list as text: `<created, in milliseconds>_<id>`. It is opaque to the
// browser, which only hands it back.
const cursorSchema = z
  .string()
  .regex(/^\d{1,16}_[^_]+$/)
  .transform((text) => {
    const [time = "", id = ""] = text.split("_");
    return { createdAt: new Date(Number(time)), id };
  })
  .pipe(z.object({ createdAt: z.date(), id: z.guid() }));

function toCursor({ createdAt, id }: NotePosition): string {
  return `${createdAt.getTime()}_${id}`;
}

/**
 * Returns one page of the owner's notes, newest first, and the cursor of the next page.
 *
 * @param cursor `nextCursor` of the page before. Without one, or with one that can't be read (a hand-edited link),
 * the list starts at the newest note.
 */
export async function listNotes({
  db,
  ownerId,
  cursor,
}: {
  db: Database;
  ownerId: string;
  cursor?: string;
}): Promise<NotePage> {
  const after = cursorSchema.safeParse(cursor).data;
  // One more than a page: its presence says there is a next page, without a second query.
  const rows = await findNotesByOwner({ db, ownerId, after, limit: NOTE_PAGE_SIZE + 1 });
  const page = rows.slice(0, NOTE_PAGE_SIZE);
  const last = page.at(-1);
  return {
    notes: page.map(toPublicNote),
    nextCursor: rows.length > NOTE_PAGE_SIZE && last ? toCursor(last.note) : null,
  };
}

/*===== Read =====*/
/** Returns one of the owner's notes; undefined for an unknown ID or another user's note. */
export async function readNote({
  db,
  ownerId,
  id,
}: {
  db: Database;
  ownerId: string;
  id: string;
}): Promise<Note | undefined> {
  if (!noteIdSchema.safeParse(id).success) return undefined;
  const found = await findOwnedNote({ db, id, ownerId });
  return found && toPublicNote(found);
}

/*===== Add =====*/
type SaveNoteResult = { kind: "success"; note: Note } | { kind: "invalid"; fields: Record<string, string> };

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
}): Promise<SaveNoteResult> {
  const parsed = noteFieldsSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid", fields: issuesToErrorData(parsed.error.issues).fields };
  const { title, body, imageMediaId } = parsed.data;

  // One transaction: if the insert fails, the image's claim is rolled back too, and the cleanup still finds it.
  return db.transaction(async (tx): Promise<SaveNoteResult> => {
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

/*===== Edit =====*/
type EditNoteResult = SaveNoteResult | { kind: "not-found" };

/**
 * Validates and stores a change to one of the owner's notes. `input` is the whole note as it should be: the image it
 * already has stays, a different one is attached in its place, and none removes it.
 *
 * An image the note stops using is released in the same transaction as the change, and its files are deleted after
 * that commits, as in `removeNote`. The new image is attached before the old one is released, so a refused image
 * leaves the note as it was.
 *
 * @returns `not-found` for an unknown ID or another user's note, `invalid` with per-field messages when the input
 * breaks a domain rule.
 */
export async function editNote({
  db,
  ownerId,
  id,
  input,
}: {
  db: Database;
  ownerId: string;
  id: string;
  input: unknown;
}): Promise<EditNoteResult> {
  if (!noteIdSchema.safeParse(id).success) return { kind: "not-found" };
  const parsed = noteFieldsSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid", fields: issuesToErrorData(parsed.error.issues).fields };
  const { title, body, imageMediaId } = parsed.data;

  let replacedMediaId: string | null = null;
  const result = await db.transaction(async (tx): Promise<EditNoteResult> => {
    // Locked: two edits swapping the image at once would both release the old one and each attach their own, and the
    // one that lost the update would stay attached to nothing.
    const owned = await lockOwnedNote({ db: tx, id, ownerId });
    if (!owned) return { kind: "not-found" };

    /*------ Image ------*/
    if (imageMediaId !== owned.imageMediaId) {
      if (imageMediaId) {
        const attached = await attachMedia({ db: tx, mediaId: imageMediaId, kind: "image", userId: ownerId });
        if (attached.kind === "invalid") {
          return { kind: "invalid", fields: { imageMediaId: m.note_error_image_unusable() } };
        }
      }
      if (owned.imageMediaId) {
        await releaseMedia({ db: tx, mediaId: owned.imageMediaId });
        replacedMediaId = owned.imageMediaId;
      }
    }

    /*------ Row ------*/
    const record = await updateNoteRow({ db: tx, id: owned.id, values: { title, body, imageMediaId } });
    const image = imageMediaId ? ((await findMediaById({ db: tx, id: imageMediaId })) ?? null) : null;
    return { kind: "success", note: toPublicNote({ note: record, image }) };
  });

  // Only after a commit that released it: a refused image returns before the release.
  if (result.kind === "success" && replacedMediaId) await discardMedia({ db, mediaId: replacedMediaId });
  return result;
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
  if (!noteIdSchema.safeParse(id).success) return { kind: "not-found" };

  const record = await db.transaction(async (tx) => {
    const owned = await lockOwnedNote({ db: tx, id, ownerId });
    if (!owned) return undefined;
    await deleteNoteRow({ db: tx, id: owned.id });
    if (owned.imageMediaId) await releaseMedia({ db: tx, mediaId: owned.imageMediaId });
    return owned;
  });
  if (!record) return { kind: "not-found" };

  if (record.imageMediaId) await discardMedia({ db, mediaId: record.imageMediaId });
  return { kind: "ok" };
}

/*===== Stats =====*/
/** Counts every user's notes, for the admin's line above the list. */
export function readNoteStats({ db }: { db: Database }): Promise<NoteStats> {
  return countNotes({ db });
}
