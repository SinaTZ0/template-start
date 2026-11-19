import { and, count, countDistinct, desc, eq, lt, or } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";

import { media, note } from "#/db/schema";
import type { MediaRecord } from "#/orpc/media/repository";
import { Db } from "#/server/db.server";

/*===== Types =====*/
export type NoteRecord = typeof note.$inferSelect;
type NewNoteRecord = typeof note.$inferInsert;
type NoteChanges = Pick<NewNoteRecord, "title" | "body" | "imageMediaId">;

/** A note with its image row, if it has one. */
export type NoteWithImage = { note: NoteRecord; image: MediaRecord | null };

/** The place of a note in the list's order: newest first, the ID settling notes created in the same millisecond. */
export type NotePosition = { createdAt: Date; id: string };

/*===== Note Repository =====*/
/**
 * Focused reads and writes of the `note` table. Every method joins the caller's `Db.transaction`, and a failed query
 * is a defect.
 */
export class NoteRepo extends Context.Service<
  NoteRepo,
  {
    /**
     * Lists one owner's notes with their images, newest first: at most `limit`, starting after the note at `after`.
     * Continuing from a position rather than an offset keeps a page stable while notes are added or deleted above it,
     * and costs the same on the last page as on the first (`note_owner_id_created_at_idx`).
     */
    readonly findByOwner: (args: {
      ownerId: string;
      after?: NotePosition;
      limit: number;
    }) => Effect.Effect<NoteWithImage[]>;
    /** Finds a note only when it belongs to the owner, so another user's note looks the same as a missing one. */
    readonly findOwned: (args: { id: string; ownerId: string }) => Effect.Effect<Option.Option<NoteWithImage>>;
    /**
     * Finds the owner's note and locks its row until the transaction ends, for a change that depends on what the note
     * holds now (its image): a second change to the same note waits and then sees the first one's result.
     */
    readonly lockOwned: (args: { id: string; ownerId: string }) => Effect.Effect<Option.Option<NoteRecord>>;
    /** Counts every user's notes and the users who own them. */
    readonly count: Effect.Effect<{ notes: number; owners: number }>;
    readonly insert: (values: NewNoteRecord) => Effect.Effect<NoteRecord>;
    readonly update: (args: { id: string; values: NoteChanges }) => Effect.Effect<NoteRecord>;
    readonly delete: (id: string) => Effect.Effect<void>;
  }
>()("app/orpc/note/NoteRepo") {
  static readonly layer = Layer.effect(
    NoteRepo,
    Effect.gen(function* () {
      const { q } = yield* Db;

      const findByOwner = Effect.fn("NoteRepo.findByOwner")(function* ({
        ownerId,
        after,
        limit,
      }: {
        ownerId: string;
        after?: NotePosition;
        limit: number;
      }) {
        const older = after
          ? or(lt(note.createdAt, after.createdAt), and(eq(note.createdAt, after.createdAt), lt(note.id, after.id)))
          : undefined;
        return yield* q
          .select({ note, image: media })
          .from(note)
          .leftJoin(media, eq(note.imageMediaId, media.id))
          .where(and(eq(note.ownerId, ownerId), older))
          .orderBy(desc(note.createdAt), desc(note.id))
          .limit(limit);
      }, Effect.orDie);

      const findOwned = Effect.fn("NoteRepo.findOwned")(function* ({ id, ownerId }: { id: string; ownerId: string }) {
        const [row] = yield* q
          .select({ note, image: media })
          .from(note)
          .leftJoin(media, eq(note.imageMediaId, media.id))
          .where(and(eq(note.id, id), eq(note.ownerId, ownerId)))
          .limit(1);
        return Option.fromNullishOr(row);
      }, Effect.orDie);

      const lockOwned = Effect.fn("NoteRepo.lockOwned")(function* ({ id, ownerId }: { id: string; ownerId: string }) {
        const [row] = yield* q
          .select()
          .from(note)
          .where(and(eq(note.id, id), eq(note.ownerId, ownerId)))
          .limit(1)
          .for("update");
        return Option.fromNullishOr(row);
      }, Effect.orDie);

      const countNotes = Effect.gen(function* () {
        const [row] = yield* q.select({ notes: count(), owners: countDistinct(note.ownerId) }).from(note);
        return row ?? { notes: 0, owners: 0 };
      }).pipe(Effect.orDie, Effect.withSpan("NoteRepo.count"));

      const insert = Effect.fn("NoteRepo.insert")(function* (values: NewNoteRecord) {
        const [row] = yield* q.insert(note).values(values).returning();
        if (!row) return yield* Effect.die(new Error("NoteRepo.insert: insert returned no row"));
        return row;
      }, Effect.orDie);

      const update = Effect.fn("NoteRepo.update")(function* ({ id, values }: { id: string; values: NoteChanges }) {
        const [row] = yield* q.update(note).set(values).where(eq(note.id, id)).returning();
        if (!row) return yield* Effect.die(new Error("NoteRepo.update: update returned no row"));
        return row;
      }, Effect.orDie);

      const del = Effect.fn("NoteRepo.delete")(function* (id: string) {
        yield* q.delete(note).where(eq(note.id, id));
      }, Effect.orDie);

      return NoteRepo.of({
        findByOwner,
        findOwned,
        lockOwned,
        count: countNotes,
        insert,
        update,
        delete: del,
      });
    }),
  );
}
