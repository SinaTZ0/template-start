import { and, desc, eq } from "drizzle-orm";

import type { Database } from "#/db/client.server";
import { media, note } from "#/db/schema";
import type { MediaRecord } from "#/orpc/media/repository";

/*===== Types =====*/
export type NoteRecord = typeof note.$inferSelect;
type NewNoteRecord = typeof note.$inferInsert;

/** A note with its image row, if it has one. */
export type NoteWithImage = { note: NoteRecord; image: MediaRecord | null };

/*===== Reads =====*/
/** Lists one owner's notes with their images, newest first. */
export function findNotesByOwner({ db, ownerId }: { db: Database; ownerId: string }): Promise<NoteWithImage[]> {
  return db
    .select({ note, image: media })
    .from(note)
    .leftJoin(media, eq(note.imageMediaId, media.id))
    .where(eq(note.ownerId, ownerId))
    .orderBy(desc(note.createdAt));
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
}): Promise<NoteRecord | undefined> {
  const [row] = await db
    .select()
    .from(note)
    .where(and(eq(note.id, id), eq(note.ownerId, ownerId)))
    .limit(1);
  return row;
}

/*===== Writes =====*/
/** Inserts a note and returns the stored row. */
export async function insertNote({ db, values }: { db: Database; values: NewNoteRecord }): Promise<NoteRecord> {
  const [row] = await db.insert(note).values(values).returning();
  if (!row) throw new Error("insertNote: insert returned no row");
  return row;
}

export async function deleteNoteRow({ db, id }: { db: Database; id: string }): Promise<void> {
  await db.delete(note).where(eq(note.id, id));
}
