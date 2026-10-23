import { and, asc, eq, isNull, lt } from "drizzle-orm";

import type { Database } from "#/db/client.server";
import { media } from "#/db/schema";

/*===== Types =====*/
export type MediaRecord = typeof media.$inferSelect;

export type MediaValues = Pick<
  typeof media.$inferInsert,
  "id" | "kind" | "uploadedBy" | "width" | "height" | "placeholder"
>;

/*===== Reads =====*/
/** Finds one media row; undefined for an unknown ID. */
export async function findMediaById({ db, id }: { db: Database; id: string }): Promise<MediaRecord | undefined> {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return row;
}

/** IDs of unattached media uploaded before `uploadedBefore`, oldest first. Served by `media_attached_at_created_at_idx`. */
export async function findOrphanedMediaIds({
  db,
  uploadedBefore,
  limit,
}: {
  db: Database;
  uploadedBefore: Date;
  limit: number;
}): Promise<string[]> {
  const rows = await db
    .select({ id: media.id })
    .from(media)
    .where(and(isNull(media.attachedAt), lt(media.createdAt, uploadedBefore)))
    .orderBy(asc(media.createdAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

/*===== Writes =====*/
/** Inserts the row of an upload whose variants are all in the bucket. It starts unattached. */
export async function insertMedia({ db, values }: { db: Database; values: MediaValues }): Promise<MediaRecord> {
  const [row] = await db.insert(media).values(values).returning();
  if (!row) throw new Error("insertMedia: insert returned no row");
  return row;
}

/**
 * Marks a media row as used, if nothing uses it yet. One statement, so two saves racing for the same upload can't both
 * win.
 *
 * @returns Whether this call claimed it: `false` when it was already attached (or doesn't exist).
 */
export async function claimMedia({ db, id }: { db: Database; id: string }): Promise<boolean> {
  const rows = await db
    .update(media)
    .set({ attachedAt: new Date() })
    .where(and(eq(media.id, id), isNull(media.attachedAt)))
    .returning({ id: media.id });
  return rows.length > 0;
}

/** Marks a media row as unused again, which puts it in the cleanup's reach. */
export async function markMediaDetached({ db, id }: { db: Database; id: string }): Promise<void> {
  await db.update(media).set({ attachedAt: null }).where(eq(media.id, id));
}

/** Deletes a media row. Entities pointing at it are cleared by the foreign key (`on delete set null`). */
export async function deleteMediaRow({ db, id }: { db: Database; id: string }): Promise<void> {
  await db.delete(media).where(eq(media.id, id));
}
