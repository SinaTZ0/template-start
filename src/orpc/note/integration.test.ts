import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "#/db/client.server";
import { media, note, user } from "#/db/schema";
import { NOTE_PAGE_SIZE } from "#/orpc/note/constants";
import { addNote, editNote, listNotes, readNote, removeNote } from "#/orpc/note/service";

/*===== Notes =====*/
// Runs against the real database (`DATABASE_URL`, after `pnpm db:push`): ownership is enforced by the queries, which
// only a real table shows. Every row is created per run and removed afterwards.

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
  const [row] = await db.select().from(media).where(eq(media.id, id));
  return row?.attachedAt ?? null;
}

beforeAll(async () => {
  await db
    .insert(user)
    .values([owner, stranger, reader].map((id) => ({ id, name: "Test user", email: `${id}@example.test` })));
  // A row is enough: attaching never touches the bucket.
  const image = { kind: "image", width: 10, height: 10, placeholder: "data:," };
  await db.insert(media).values([
    { ...image, id: strangersImage, uploadedBy: stranger },
    { ...image, id: ownersImage, uploadedBy: owner },
    { ...image, id: firstImage, uploadedBy: owner },
    { ...image, id: secondImage, uploadedBy: owner },
  ]);
});

afterAll(async () => {
  await db.delete(note).where(inArray(note.ownerId, [owner, stranger, reader]));
  await db.delete(media).where(inArray(media.uploadedBy, [owner, stranger]));
  await db.delete(user).where(inArray(user.id, [owner, stranger, reader]));
  await db.$client.end();
});

describe("notes", () => {
  it("stores a trimmed note and lists it only for its owner", async () => {
    const result = await addNote({ db, ownerId: owner, input: { title: "  خرید  ", body: "نان" } });
    expect(result).toMatchObject({ kind: "success", note: { title: "خرید", body: "نان", image: null } });

    expect((await listNotes({ db, ownerId: owner })).notes.map((item) => item.title)).toEqual(["خرید"]);
    expect((await listNotes({ db, ownerId: stranger })).notes).toEqual([]);
  });

  it("rejects an empty title and someone else's image with field messages", async () => {
    const empty = await addNote({ db, ownerId: owner, input: { title: " " } });
    expect(empty).toMatchObject({ kind: "invalid", fields: { title: expect.any(String) } });

    const borrowed = await addNote({ db, ownerId: owner, input: { title: "عکس", imageMediaId: strangersImage } });
    expect(borrowed).toMatchObject({ kind: "invalid", fields: { imageMediaId: expect.any(String) } });
  });

  it("lets only the owner delete a note", async () => {
    const created = await addNote({ db, ownerId: owner, input: { title: "حذف‌شدنی" } });
    if (created.kind !== "success") throw new Error("setup failed");

    expect(await removeNote({ db, ownerId: stranger, id: created.note.id })).toEqual({ kind: "not-found" });
    expect(await removeNote({ db, ownerId: owner, id: created.note.id })).toEqual({ kind: "ok" });
    expect(await removeNote({ db, ownerId: owner, id: "not-a-uuid" })).toEqual({ kind: "not-found" });
  });

  it("keeps an image to one note, and lets the cleanup reach it once that note is deleted", async () => {
    const first = await addNote({ db, ownerId: owner, input: { title: "اول", imageMediaId: ownersImage } });
    if (first.kind !== "success") throw new Error("setup failed");

    const second = await addNote({ db, ownerId: owner, input: { title: "دوم", imageMediaId: ownersImage } });
    expect(second).toMatchObject({ kind: "invalid", fields: { imageMediaId: expect.any(String) } });

    // The bucket delete may fail where no store runs; either way the image must not stay attached to nothing.
    expect(await removeNote({ db, ownerId: owner, id: first.note.id })).toEqual({ kind: "ok" });
    const [left] = await db.select().from(media).where(eq(media.id, ownersImage));
    expect(left?.attachedAt ?? null).toBeNull();
  });

  it("lets only the owner read and change a note", async () => {
    const created = await addNote({ db, ownerId: owner, input: { title: "پیش‌نویس" } });
    if (created.kind !== "success") throw new Error("setup failed");
    const { id } = created.note;

    expect(await readNote({ db, ownerId: stranger, id })).toBeUndefined();
    expect(await editNote({ db, ownerId: stranger, id, input: { title: "دزدی" } })).toEqual({ kind: "not-found" });

    const edited = await editNote({ db, ownerId: owner, id, input: { title: " نهایی ", body: "متن" } });
    expect(edited).toMatchObject({ kind: "success", note: { id, title: "نهایی", body: "متن" } });
    expect(await readNote({ db, ownerId: owner, id })).toMatchObject({ title: "نهایی" });
  });

  it("releases the image an edit replaces, and keeps it when the new one is refused", async () => {
    const created = await addNote({ db, ownerId: owner, input: { title: "عکس‌دار", imageMediaId: firstImage } });
    if (created.kind !== "success") throw new Error("setup failed");
    const { id } = created.note;

    const refused = await editNote({
      db,
      ownerId: owner,
      id,
      input: { title: "عکس‌دار", imageMediaId: strangersImage },
    });
    expect(refused).toMatchObject({ kind: "invalid", fields: { imageMediaId: expect.any(String) } });
    expect(await attachedAt(firstImage)).not.toBeNull();

    // Saving again with the same image is not a second claim on it.
    const kept = await editNote({ db, ownerId: owner, id, input: { title: "همان عکس", imageMediaId: firstImage } });
    expect(kept).toMatchObject({ kind: "success", note: { image: { id: firstImage } } });

    const swapped = await editNote({ db, ownerId: owner, id, input: { title: "عکس تازه", imageMediaId: secondImage } });
    expect(swapped).toMatchObject({ kind: "success", note: { image: { id: secondImage } } });
    // Deleted, or left unattached for the cleanup where no store runs.
    expect(await attachedAt(firstImage)).toBeNull();
    expect(await attachedAt(secondImage)).not.toBeNull();
  });

  it("pages through the list without repeating or skipping a note", async () => {
    // Created in one statement, so they share a timestamp and only the ID orders them.
    const total = NOTE_PAGE_SIZE + 3;
    await db.insert(note).values(Array.from({ length: total }, (_, i) => ({ ownerId: reader, title: `${i}` })));

    const first = await listNotes({ db, ownerId: reader });
    expect(first.notes).toHaveLength(NOTE_PAGE_SIZE);
    const second = await listNotes({ db, ownerId: reader, cursor: first.nextCursor ?? undefined });
    expect(second.nextCursor).toBeNull();

    const seen = new Set([...first.notes, ...second.notes].map((item) => item.id));
    expect(seen.size).toBe(total);

    // A cursor that can't be read starts over instead of failing the page.
    expect((await listNotes({ db, ownerId: reader, cursor: "nonsense" })).notes).toHaveLength(NOTE_PAGE_SIZE);
  });
});
