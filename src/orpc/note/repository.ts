import { and, count, countDistinct, desc, eq, lt, or } from "drizzle-orm";

import type { Database } from "#/db/client.server";
import { media, note } from "#/db/schema";
import type { MediaRecord } from "#/orpc/media/repository";

/*===== Types =====*/
export type NoteRecord = typeof note.$inferSelect;
type NewNoteRecord = typeof note.$inferInsert;
type NoteChanges = Pick<NewNoteRecord, "title" | "body" | "imageMediaId">;

/** A note with its image row, if it has one. */
export type NoteWithImage = { note: NoteRecord; image: MediaRecord | null };

/** The place of a note in the list's order: newest first, the ID settling notes created in the same millisecond. */
export type NotePosition = { createdAt: Date; id: string };

/*===== Reads =====*/
/**
 * Lists one owner's notes with their images, newest first: at most `limit`, starting after the note at `after`.
 * Continuing from a position rather than an offset keeps a page stable while notes are added or deleted above it, and
 * costs the same on the last page as on the first (`note_owner_id_created_at_idx`).
 */
export function findNotesByOwner({
  db,
  ownerId,
  after,
  limit,
}: {
  db: Database;
  ownerId: string;
  after?: NotePosition;
  limit: number;
}): Promise<NoteWithImage[]> {
  const older = after
    ? or(lt(note.createdAt, after.createdAt), and(eq(note.createdAt, after.createdAt), lt(note.id, after.id)))
    : undefined;
  return db
    .select({ note, image: media })
    .from(note)
    .leftJoin(media, eq(note.imageMediaId, media.id))
    .where(and(eq(note.ownerId, ownerId), older))
    .orderBy(desc(note.createdAt), desc(note.id))
    .limit(limit);
}

/** Finds a note only when it belongs to the owner, so another user's note looks the same as a missing one. */
export async function findOwnedNote({
  db,
  id,
  ownerId,
}: {
  db: Database;
  id: string;
  ownerId: string;
}): Promise<NoteWithImage | undefined> {
  const [row] = await db
    .select({ note, image: media })
    .from(note)
    .leftJoin(media, eq(note.imageMediaId, media.id))
    .where(and(eq(note.id, id), eq(note.ownerId, ownerId)))
    .limit(1);
  return row;
}

/**
 * Finds the owner's note and locks its row until the transaction ends, for a change that depends on what the note
 * holds now (its image): a second change to the same note waits and then sees the first one's result.
 */
export async function lockOwnedNote({
  db,
  id,
  ownerId,
}: {
  db: Database;
  id: string;
  ownerId: string;
}): Promise<NoteRecord | undefined> {
  const [row] = await db
    .select()
    .from(note)
    .where(and(eq(note.id, id), eq(note.ownerId, ownerId)))
    .limit(1)
    .for("update");
  return row;
}

/** Counts every user's notes and the users who own them. */
export async function countNotes({ db }: { db: Database }): Promise<{ notes: number; owners: number }> {
  const [row] = await db.select({ notes: count(), owners: countDistinct(note.ownerId) }).from(note);
  return row ?? { notes: 0, owners: 0 };
}

/*===== Writes =====*/
/** Inserts a note and returns the stored row. */
export async function insertNote({ db, values }: { db: Database; values: NewNoteRecord }): Promise<NoteRecord> {
  const [row] = await db.insert(note).values(values).returning();
  if (!row) throw new Error("insertNote: insert returned no row");
  return row;
}

/** Changes a note's fields and returns the stored row. */
export async function updateNoteRow({
  db,
  id,
  values,
}: {
  db: Database;
  id: string;
  values: NoteChanges;
}): Promise<NoteRecord> {
  const [row] = await db.update(note).set(values).where(eq(note.id, id)).returning();
  if (!row) throw new Error("updateNoteRow: update returned no row");
  return row;
}

export async function deleteNoteRow({ db, id }: { db: Database; id: string }): Promise<void> {
  await db.delete(note).where(eq(note.id, id));
}
