import { Context, Effect, Layer, Option, Schema } from "effect";

import { MediaService } from "#/orpc/media/service";
import type { MediaUnusable } from "#/orpc/media/errors";
import { MediaRepo } from "#/orpc/media/repository";
import { NOTE_PAGE_SIZE } from "#/orpc/note/constants";
import type { Note, NotePage, NoteStats } from "#/orpc/note/contract";
import { NoteNotFound } from "#/orpc/note/errors";
import { toPublicNote } from "#/orpc/note/mapper";
import { NoteRepo } from "#/orpc/note/repository";
import type { NotePosition, NoteRecord } from "#/orpc/note/repository";
import { NoteFields } from "#/orpc/note/validation";
import { Db } from "#/server/db.server";
import { decodeInput } from "#/server/errors";
import type { InvalidInput } from "#/server/errors";

/*===== IDs =====*/
/** A malformed UUID would make Postgres throw, so an ID is checked before it reaches a query. */
const isNoteId = Schema.is(Schema.String.check(Schema.isUUID()));

/*===== Cursor =====*/
// A cursor is the last note's place in the list as text: `<created, in milliseconds>_<id>`. It is opaque to the
// browser, which only hands it back.
const CURSOR = /^(\d{1,16})_([^_]+)$/;

/** The position a cursor names, or none for one that can't be read (a hand-edited link): the list then starts over. */
function fromCursor(cursor: string | undefined): NotePosition | undefined {
  const [, time = "", id = ""] = CURSOR.exec(cursor ?? "") ?? [];
  const createdAt = new Date(Number(time));
  return time && isNoteId(id) && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : undefined;
}

function toCursor({ createdAt, id }: NotePosition): string {
  return `${createdAt.getTime()}_${id}`;
}

/*===== Note Service =====*/
export class NoteService extends Context.Service<
  NoteService,
  {
    /**
     * One page of the owner's notes, newest first, and the cursor of the next page.
     *
     * @param cursor `nextCursor` of the page before. Without one, or with one that can't be read, the list starts at
     * the newest note.
     */
    readonly list: (args: { ownerId: string; cursor?: string }) => Effect.Effect<NotePage>;
    /** One of the owner's notes. */
    readonly read: (args: { ownerId: string; id: string }) => Effect.Effect<Note, NoteNotFound>;
    /**
     * Validates and stores a new note. An image must be an `image` upload by the same user that no other entity uses;
     * it is attached in the same transaction, so a failed insert leaves it to the cleanup.
     */
    readonly add: (args: { ownerId: string; input: unknown }) => Effect.Effect<Note, InvalidInput | MediaUnusable>;
    /**
     * Validates and stores a change. `input` is the whole note as it should be: the image it already has stays, a
     * different one is attached in its place, and none removes it. An image the note stops using is released in the
     * same transaction, which also queues the deletion of its files. The new image is attached before the old one is
     * released, so a refused image leaves the note as it was.
     */
    readonly edit: (args: {
      ownerId: string;
      id: string;
      input: unknown;
    }) => Effect.Effect<Note, NoteNotFound | InvalidInput | MediaUnusable>;
    /** Deletes one of the owner's notes and lets go of its image, in one transaction (docs/backend/media.md). */
    readonly remove: (args: { ownerId: string; id: string }) => Effect.Effect<void, NoteNotFound>;
    /** Counts every user's notes, for the admin's line above the list. */
    readonly stats: Effect.Effect<NoteStats>;
  }
>()("app/orpc/note/NoteService") {
  static readonly layer = Layer.effect(
    NoteService,
    Effect.gen(function* () {
      const db = yield* Db;
      const notes = yield* NoteRepo;
      const mediaRepo = yield* MediaRepo;
      const mediaService = yield* MediaService;
      const decodeFields = decodeInput(NoteFields);

      /** A stored note with its image, in its public shape. */
      const publicNote = (record: NoteRecord) =>
        Effect.map(record.imageMediaId ? mediaRepo.findById(record.imageMediaId) : Effect.succeedNone, (image) =>
          toPublicNote({ note: record, image: Option.getOrNull(image) }),
        );

      /*------ List ------*/
      const list = Effect.fn("NoteService.list")(function* ({ ownerId, cursor }: { ownerId: string; cursor?: string }) {
        // One more than a page: its presence says there is a next page, without a second query.
        const rows = yield* notes.findByOwner({ ownerId, after: fromCursor(cursor), limit: NOTE_PAGE_SIZE + 1 });
        const page = rows.slice(0, NOTE_PAGE_SIZE);
        const last = page.at(-1);
        return {
          notes: page.map(toPublicNote),
          nextCursor: rows.length > NOTE_PAGE_SIZE && last ? toCursor(last.note) : null,
        };
      });

      /*------ Read ------*/
      const read = Effect.fn("NoteService.read")(function* ({ ownerId, id }: { ownerId: string; id: string }) {
        if (!isNoteId(id)) return yield* new NoteNotFound({ id });
        const found = yield* notes.findOwned({ id, ownerId });
        if (Option.isNone(found)) return yield* new NoteNotFound({ id });
        return toPublicNote(found.value);
      });

      /*------ Add ------*/
      const add = Effect.fn("NoteService.add")(function* ({ ownerId, input }: { ownerId: string; input: unknown }) {
        const { title, body = "", imageMediaId } = yield* decodeFields(input);
        const image = imageMediaId || null;

        return yield* db.transaction(
          Effect.gen(function* () {
            if (image) yield* mediaService.attach({ mediaId: image, kind: "image", userId: ownerId });
            const record = yield* notes.insert({ ownerId, title, body, imageMediaId: image });
            return yield* publicNote(record);
          }),
        );
      });

      /*------ Edit ------*/
      const edit = Effect.fn("NoteService.edit")(function* ({
        ownerId,
        id,
        input,
      }: {
        ownerId: string;
        id: string;
        input: unknown;
      }) {
        if (!isNoteId(id)) return yield* new NoteNotFound({ id });
        const { title, body = "", imageMediaId } = yield* decodeFields(input);
        const image = imageMediaId || null;

        return yield* db.transaction(
          Effect.gen(function* () {
            // Locked: two edits swapping the image at once would both release the old one and each attach their own,
            // and the one that lost the update would stay attached to nothing.
            const owned = yield* notes.lockOwned({ id, ownerId });
            if (Option.isNone(owned)) return yield* new NoteNotFound({ id });
            const current = owned.value;

            if (image !== current.imageMediaId) {
              if (image) yield* mediaService.attach({ mediaId: image, kind: "image", userId: ownerId });
              if (current.imageMediaId) yield* mediaService.release(current.imageMediaId);
            }

            const record = yield* notes.update({ id: current.id, values: { title, body, imageMediaId: image } });
            return yield* publicNote(record);
          }),
        );
      });

      /*------ Remove ------*/
      const remove = Effect.fn("NoteService.remove")(function* ({ ownerId, id }: { ownerId: string; id: string }) {
        if (!isNoteId(id)) return yield* new NoteNotFound({ id });

        yield* db.transaction(
          Effect.gen(function* () {
            const owned = yield* notes.lockOwned({ id, ownerId });
            if (Option.isNone(owned)) return yield* new NoteNotFound({ id });
            yield* notes.delete(owned.value.id);
            if (owned.value.imageMediaId) yield* mediaService.release(owned.value.imageMediaId);
          }),
        );
      });

      return NoteService.of({ list, read, add, edit, remove, stats: notes.count });
    }),
  );
}
