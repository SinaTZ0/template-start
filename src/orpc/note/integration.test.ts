import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { Effect, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { media, note, user } from "#/db/schema";
import { issueToErrorData } from "#/lib/schema";
import { MediaUnusable } from "#/orpc/media/errors";
import { NOTE_PAGE_SIZE } from "#/orpc/note/constants";
import { NoteNotFound } from "#/orpc/note/errors";
import { NoteService } from "#/orpc/note/service";
import { Db } from "#/server/db.server";
import { InvalidInput } from "#/server/errors";
import { AppLayer } from "#/server/runtime.server";
import type { AppServices } from "#/server/runtime.server";

/*===== Notes =====*/
// Runs against the real database (`DATABASE_URL`, after `pnpm db:migrate`) on the app's own layers: ownership is
// enforced by the queries, and releasing an image queues a job in the same transaction, which only real tables show.
// Every row is created per run and removed afterwards.

const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
/** Runs an Effect that must fail, and returns its error. */
const failure = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(Effect.flip(effect));
const notes = <A, E>(f: (service: NoteService["Service"]) => Effect.Effect<A, E>) => NoteService.use(f);
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
async function attachedAt(id: string): Promise<Date | null> {
  const [row] = await run(query((q) => q.select().from(media).where(eq(media.id, id))));
  return row?.attachedAt ?? null;
}

/** The field messages an invalid input shows. */
function fieldsOf(error: unknown): Record<string, string> {
  expect(error).toBeInstanceOf(InvalidInput);
  return issueToErrorData((error as InvalidInput).issue).fields;
}

beforeAll(async () => {
  await run(
    query((q) =>
      q
        .insert(user)
        .values([owner, stranger, reader].map((id) => ({ id, name: "Test user", email: `${id}@example.test` }))),
    ),
  );
  // A row is enough: attaching never touches the bucket.
  const image = { kind: "image", width: 10, height: 10, placeholder: "data:," };
  await run(
    query((q) =>
      q.insert(media).values([
        { ...image, id: strangersImage, uploadedBy: stranger },
        { ...image, id: ownersImage, uploadedBy: owner },
        { ...image, id: firstImage, uploadedBy: owner },
        { ...image, id: secondImage, uploadedBy: owner },
      ]),
    ),
  );
});

afterAll(async () => {
  await run(query((q) => q.delete(note).where(inArray(note.ownerId, [owner, stranger, reader]))));
  await run(query((q) => q.delete(media).where(inArray(media.uploadedBy, [owner, stranger]))));
  await run(query((q) => q.delete(user).where(inArray(user.id, [owner, stranger, reader]))));
  await runtime.dispose();
});

describe("notes", () => {
  it("stores a normalized note and lists it only for its owner", async () => {
    const created = await run(notes((s) => s.add({ ownerId: owner, input: { title: "  خريد  ", body: "نان" } })));
    // Trimmed, and the Arabic yeh is Persian.
    expect(created).toMatchObject({ title: "خرید", body: "نان", image: null });

    expect((await run(notes((s) => s.list({ ownerId: owner })))).notes.map((item) => item.title)).toEqual(["خرید"]);
    expect((await run(notes((s) => s.list({ ownerId: stranger })))).notes).toEqual([]);
  });

  it("rejects an empty title with a field message, and someone else's image", async () => {
    const empty = await failure(notes((s) => s.add({ ownerId: owner, input: { title: " " } })));
    expect(fieldsOf(empty)).toEqual({ title: expect.any(String) });

    const borrowed = await failure(
      notes((s) => s.add({ ownerId: owner, input: { title: "عکس", imageMediaId: strangersImage } })),
    );
    expect(borrowed).toBeInstanceOf(MediaUnusable);
  });

  it("lets only the owner delete a note", async () => {
    const { id } = await run(notes((s) => s.add({ ownerId: owner, input: { title: "حذف‌شدنی" } })));

    expect(await failure(notes((s) => s.remove({ ownerId: stranger, id })))).toBeInstanceOf(NoteNotFound);
    await run(notes((s) => s.remove({ ownerId: owner, id })));
    expect(await failure(notes((s) => s.remove({ ownerId: owner, id: "not-a-uuid" })))).toBeInstanceOf(NoteNotFound);
  });

  it("keeps an image to one note, and lets the cleanup reach it once that note is deleted", async () => {
    const first = await run(
      notes((s) => s.add({ ownerId: owner, input: { title: "اول", imageMediaId: ownersImage } })),
    );

    const second = await failure(
      notes((s) => s.add({ ownerId: owner, input: { title: "دوم", imageMediaId: ownersImage } })),
    );
    expect(second).toBeInstanceOf(MediaUnusable);

    // The files are deleted by a queued job, which no test runs; the image must not stay attached to nothing.
    await run(notes((s) => s.remove({ ownerId: owner, id: first.id })));
    expect(await attachedAt(ownersImage)).toBeNull();
  });

  it("lets only the owner read and change a note", async () => {
    const { id } = await run(notes((s) => s.add({ ownerId: owner, input: { title: "پیش‌نویس" } })));

    expect(await failure(notes((s) => s.read({ ownerId: stranger, id })))).toBeInstanceOf(NoteNotFound);
    expect(await failure(notes((s) => s.edit({ ownerId: stranger, id, input: { title: "دزدی" } })))).toBeInstanceOf(
      NoteNotFound,
    );

    const edited = await run(notes((s) => s.edit({ ownerId: owner, id, input: { title: " نهایی ", body: "متن" } })));
    expect(edited).toMatchObject({ id, title: "نهایی", body: "متن" });
    expect(await run(notes((s) => s.read({ ownerId: owner, id })))).toMatchObject({ title: "نهایی" });
  });

  it("releases the image an edit replaces, and keeps it when the new one is refused", async () => {
    const { id } = await run(
      notes((s) => s.add({ ownerId: owner, input: { title: "عکس‌دار", imageMediaId: firstImage } })),
    );

    const refused = await failure(
      notes((s) => s.edit({ ownerId: owner, id, input: { title: "عکس‌دار", imageMediaId: strangersImage } })),
    );
    expect(refused).toBeInstanceOf(MediaUnusable);
    expect(await attachedAt(firstImage)).not.toBeNull();

    // Saving again with the same image is not a second claim on it.
    const kept = await run(
      notes((s) => s.edit({ ownerId: owner, id, input: { title: "همان عکس", imageMediaId: firstImage } })),
    );
    expect(kept).toMatchObject({ image: { id: firstImage } });

    const swapped = await run(
      notes((s) => s.edit({ ownerId: owner, id, input: { title: "عکس تازه", imageMediaId: secondImage } })),
    );
    expect(swapped).toMatchObject({ image: { id: secondImage } });
    // Released, with its deletion queued.
    expect(await attachedAt(firstImage)).toBeNull();
    expect(await attachedAt(secondImage)).not.toBeNull();
  });

  it("pages through the list without repeating or skipping a note", async () => {
    // Created in one statement, so they share a timestamp and only the ID orders them.
    const total = NOTE_PAGE_SIZE + 3;
    await run(
      query((q) =>
        q.insert(note).values(Array.from({ length: total }, (_, i) => ({ ownerId: reader, title: `${i}` }))),
      ),
    );

    const first = await run(notes((s) => s.list({ ownerId: reader })));
    expect(first.notes).toHaveLength(NOTE_PAGE_SIZE);
    const second = await run(notes((s) => s.list({ ownerId: reader, cursor: first.nextCursor ?? undefined })));
    expect(second.nextCursor).toBeNull();

    const seen = new Set([...first.notes, ...second.notes].map((item) => item.id));
    expect(seen.size).toBe(total);

    // A cursor that can't be read starts over instead of failing the page.
    expect((await run(notes((s) => s.list({ ownerId: reader, cursor: "nonsense" })))).notes).toHaveLength(
      NOTE_PAGE_SIZE,
    );
  });
});
