import { randomUUID } from "node:crypto";

import { expect, layer } from "@effect/vitest";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { media, note, user } from "#/db/schema";
import { issueToErrorData } from "#/lib/schema";
import { MediaUnusable } from "#/orpc/media/errors";
import { NOTE_PAGE_SIZE } from "#/orpc/note/constants";
import { NoteNotFound } from "#/orpc/note/errors";
import { NoteService } from "#/orpc/note/service";
import { Db } from "#/server/db.server";
import { InvalidInput } from "#/server/errors";
import { AppLayer } from "#/server/runtime.server";

/*===== Notes =====*/
// Runs against the real database (`DATABASE_URL`, after `pnpm db:migrate`) on the app's own layers: ownership is
// enforced by the queries, and releasing an image queues a job in the same transaction, which only real tables show.
// Every row is created per run and removed afterwards.

const query = <A>(f: (q: Db["Service"]["q"]) => Effect.Effect<A, unknown>) =>
  Db.use(({ q }) => f(q).pipe(Effect.orDie));

const runId = randomUUID().slice(0, 8);
const owner = `test-note-owner-${runId}`;
const stranger = `test-note-stranger-${runId}`;
const reader = `test-note-reader-${runId}`;
const strangersImage = randomUUID();
const ownersImage = randomUUID();
const firstImage = randomUUID();
const secondImage = randomUUID();

/** When a media was attached; null for one that is unattached or already deleted. */
const attachedAt = (id: string) =>
  query((q) => q.select().from(media).where(eq(media.id, id))).pipe(Effect.map(([row]) => row?.attachedAt ?? null));

/** The field messages an invalid input shows. */
function fieldsOf(error: unknown): Record<string, string> {
  expect(error).toBeInstanceOf(InvalidInput);
  return issueToErrorData((error as InvalidInput).issue).fields;
}

/*===== Fixtures =====*/
/** This run's users and uploads: created when the layer is built, removed with their notes when it closes. */
const Fixtures = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.gen(function* () {
      yield* query((q) =>
        q
          .insert(user)
          .values([owner, stranger, reader].map((id) => ({ id, name: "Test user", email: `${id}@example.test` }))),
      );
      // A row is enough: attaching never touches the bucket.
      const image = { kind: "image", width: 10, height: 10, placeholder: "data:," };
      yield* query((q) =>
        q.insert(media).values([
          { ...image, id: strangersImage, uploadedBy: stranger },
          { ...image, id: ownersImage, uploadedBy: owner },
          { ...image, id: firstImage, uploadedBy: owner },
          { ...image, id: secondImage, uploadedBy: owner },
        ]),
      );
    }),
    () =>
      Effect.gen(function* () {
        yield* query((q) => q.delete(note).where(inArray(note.ownerId, [owner, stranger, reader])));
        yield* query((q) => q.delete(media).where(inArray(media.uploadedBy, [owner, stranger])));
        yield* query((q) => q.delete(user).where(inArray(user.id, [owner, stranger, reader])));
      }),
  ),
);

/*===== Tests =====*/
// On the real clock (`excludeTestServices`): the pool's timeouts and the attach window count real time, and the test
// clock stands still at 1970.
layer(Fixtures.pipe(Layer.provideMerge(AppLayer)), { excludeTestServices: true })("notes", (it) => {
  it.effect("stores a normalized note and lists it only for its owner", () =>
    Effect.gen(function* () {
      const notes = yield* NoteService;
      const created = yield* notes.add({ ownerId: owner, input: { title: "  خريد  ", body: "نان" } });
      // Trimmed, and the Arabic yeh is Persian.
      expect(created).toMatchObject({ title: "خرید", body: "نان", image: null });

      const owners = yield* notes.list({ ownerId: owner });
      expect(owners.notes.map((item) => item.title)).toEqual(["خرید"]);
      const strangers = yield* notes.list({ ownerId: stranger });
      expect(strangers.notes).toEqual([]);
    }),
  );

  it.effect("rejects an empty title with a field message, and someone else's image", () =>
    Effect.gen(function* () {
      const notes = yield* NoteService;
      const empty = yield* Effect.flip(notes.add({ ownerId: owner, input: { title: " " } }));
      expect(fieldsOf(empty)).toEqual({ title: expect.any(String) });

      const borrowed = yield* Effect.flip(
        notes.add({ ownerId: owner, input: { title: "عکس", imageMediaId: strangersImage } }),
      );
      expect(borrowed).toBeInstanceOf(MediaUnusable);
    }),
  );

  it.effect("lets only the owner delete a note", () =>
    Effect.gen(function* () {
      const notes = yield* NoteService;
      const { id } = yield* notes.add({ ownerId: owner, input: { title: "حذف‌شدنی" } });

      const strangers = yield* Effect.flip(notes.remove({ ownerId: stranger, id }));
      expect(strangers).toBeInstanceOf(NoteNotFound);
      yield* notes.remove({ ownerId: owner, id });
      const malformed = yield* Effect.flip(notes.remove({ ownerId: owner, id: "not-a-uuid" }));
      expect(malformed).toBeInstanceOf(NoteNotFound);
    }),
  );

  it.effect("keeps an image to one note, and lets the cleanup reach it once that note is deleted", () =>
    Effect.gen(function* () {
      const notes = yield* NoteService;
      const first = yield* notes.add({ ownerId: owner, input: { title: "اول", imageMediaId: ownersImage } });

      const second = yield* Effect.flip(
        notes.add({ ownerId: owner, input: { title: "دوم", imageMediaId: ownersImage } }),
      );
      expect(second).toBeInstanceOf(MediaUnusable);

      // The files are deleted by a queued job, which no test runs; the image must not stay attached to nothing.
      yield* notes.remove({ ownerId: owner, id: first.id });
      expect(yield* attachedAt(ownersImage)).toBeNull();
    }),
  );

  it.effect("lets only the owner read and change a note", () =>
    Effect.gen(function* () {
      const notes = yield* NoteService;
      const { id } = yield* notes.add({ ownerId: owner, input: { title: "پیش‌نویس" } });

      const read = yield* Effect.flip(notes.read({ ownerId: stranger, id }));
      expect(read).toBeInstanceOf(NoteNotFound);
      const changed = yield* Effect.flip(notes.edit({ ownerId: stranger, id, input: { title: "دزدی" } }));
      expect(changed).toBeInstanceOf(NoteNotFound);

      const edited = yield* notes.edit({ ownerId: owner, id, input: { title: " نهایی ", body: "متن" } });
      expect(edited).toMatchObject({ id, title: "نهایی", body: "متن" });
      expect(yield* notes.read({ ownerId: owner, id })).toMatchObject({ title: "نهایی" });
    }),
  );

  it.effect("releases the image an edit replaces, and keeps it when the new one is refused", () =>
    Effect.gen(function* () {
      const notes = yield* NoteService;
      const { id } = yield* notes.add({ ownerId: owner, input: { title: "عکس‌دار", imageMediaId: firstImage } });

      const refused = yield* Effect.flip(
        notes.edit({ ownerId: owner, id, input: { title: "عکس‌دار", imageMediaId: strangersImage } }),
      );
      expect(refused).toBeInstanceOf(MediaUnusable);
      expect(yield* attachedAt(firstImage)).not.toBeNull();

      // Saving again with the same image is not a second claim on it.
      const kept = yield* notes.edit({ ownerId: owner, id, input: { title: "همان عکس", imageMediaId: firstImage } });
      expect(kept).toMatchObject({ image: { id: firstImage } });

      const swapped = yield* notes.edit({
        ownerId: owner,
        id,
        input: { title: "عکس تازه", imageMediaId: secondImage },
      });
      expect(swapped).toMatchObject({ image: { id: secondImage } });
      // Released, with its deletion queued.
      expect(yield* attachedAt(firstImage)).toBeNull();
      expect(yield* attachedAt(secondImage)).not.toBeNull();
    }),
  );

  it.effect("pages through the list without repeating or skipping a note", () =>
    Effect.gen(function* () {
      const notes = yield* NoteService;
      // Created in one statement, so they share a timestamp and only the ID orders them.
      const total = NOTE_PAGE_SIZE + 3;
      yield* query((q) =>
        q.insert(note).values(Array.from({ length: total }, (_, i) => ({ ownerId: reader, title: `${i}` }))),
      );

      const first = yield* notes.list({ ownerId: reader });
      expect(first.notes).toHaveLength(NOTE_PAGE_SIZE);
      const second = yield* notes.list({ ownerId: reader, cursor: first.nextCursor ?? undefined });
      expect(second.nextCursor).toBeNull();

      const seen = new Set([...first.notes, ...second.notes].map((item) => item.id));
      expect(seen.size).toBe(total);

      // A cursor that can't be read starts over instead of failing the page.
      const restarted = yield* notes.list({ ownerId: reader, cursor: "nonsense" });
      expect(restarted.notes).toHaveLength(NOTE_PAGE_SIZE);
    }),
  );
});
