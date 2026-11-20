import { and, asc, count, eq, isNull, lt } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Option } from "effect";

import { media } from "#/db/schema";
import { Db } from "#/server/db.server";

/*===== Types =====*/
export type MediaRecord = typeof media.$inferSelect;

export type MediaValues = Pick<
  typeof media.$inferInsert,
  "id" | "kind" | "uploadedBy" | "width" | "height" | "placeholder"
>;

/*===== Media Repository =====*/
/**
 * Focused reads and writes of the `media` table. Every method joins the caller's `Db.transaction`, and a failed query
 * is a defect.
 */
export class MediaRepo extends Context.Service<
  MediaRepo,
  {
    readonly findById: (id: string) => Effect.Effect<Option.Option<MediaRecord>>;
    /** IDs of unattached media uploaded before `uploadedBefore`, oldest first (`media_attached_at_created_at_idx`). */
    readonly findOrphanedIds: (args: { uploadedBefore: Date; limit: number }) => Effect.Effect<string[]>;
    /** How many of a user's uploads nothing uses yet: forms still open, forms abandoned, and released media. */
    readonly countUnattached: (userId: string) => Effect.Effect<number>;
    /** Inserts the row of an upload whose variants are all in the bucket. It starts unattached. */
    readonly insert: (values: MediaValues) => Effect.Effect<MediaRecord>;
    /**
     * Marks a media row as used, if nothing uses it yet. One statement, so two saves racing for the same upload can't
     * both win. Succeeds with whether this call claimed it.
     */
    readonly claim: (id: string) => Effect.Effect<boolean>;
    /** Marks a media row as unused again, which puts it in the cleanup's reach. */
    readonly markDetached: (id: string) => Effect.Effect<void>;
    /** Deletes a media row. Entities pointing at it are cleared by the foreign key (`on delete set null`). */
    readonly delete: (id: string) => Effect.Effect<void>;
  }
>()("app/orpc/media/MediaRepo") {
  static readonly layer = Layer.effect(
    MediaRepo,
    Effect.gen(function* () {
      const { q } = yield* Db;

      const findById = Effect.fn("MediaRepo.findById")(function* (id: string) {
        const [row] = yield* q.select().from(media).where(eq(media.id, id)).limit(1);
        return Option.fromNullishOr(row);
      }, Effect.orDie);

      const findOrphanedIds = Effect.fn("MediaRepo.findOrphanedIds")(function* ({
        uploadedBefore,
        limit,
      }: {
        uploadedBefore: Date;
        limit: number;
      }) {
        const rows = yield* q
          .select({ id: media.id })
          .from(media)
          .where(and(isNull(media.attachedAt), lt(media.createdAt, uploadedBefore)))
          .orderBy(asc(media.createdAt))
          .limit(limit);
        return rows.map((row) => row.id);
      }, Effect.orDie);

      const countUnattached = Effect.fn("MediaRepo.countUnattached")(function* (userId: string) {
        const [row] = yield* q
          .select({ total: count() })
          .from(media)
          .where(and(eq(media.uploadedBy, userId), isNull(media.attachedAt)));
        return row?.total ?? 0;
      }, Effect.orDie);

      const insert = Effect.fn("MediaRepo.insert")(function* (values: MediaValues) {
        const [row] = yield* q.insert(media).values(values).returning();
        if (!row) return yield* Effect.die(new Error("MediaRepo.insert: insert returned no row"));
        return row;
      }, Effect.orDie);

      const claim = Effect.fn("MediaRepo.claim")(function* (id: string) {
        const rows = yield* q
          .update(media)
          .set({ attachedAt: yield* DateTime.nowAsDate })
          .where(and(eq(media.id, id), isNull(media.attachedAt)))
          .returning({ id: media.id });
        return rows.length > 0;
      }, Effect.orDie);

      const markDetached = Effect.fn("MediaRepo.markDetached")(function* (id: string) {
        yield* q.update(media).set({ attachedAt: null }).where(eq(media.id, id));
      }, Effect.orDie);

      const del = Effect.fn("MediaRepo.delete")(function* (id: string) {
        yield* q.delete(media).where(eq(media.id, id));
      }, Effect.orDie);

      return MediaRepo.of({ findById, findOrphanedIds, countUnattached, insert, claim, markDetached, delete: del });
    }),
  );
}
