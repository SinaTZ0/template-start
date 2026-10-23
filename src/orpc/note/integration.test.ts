import { randomUUID } from "node:crypto";

import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "#/db/client.server";
import { media, note, user } from "#/db/schema";
import { addNote, listNotes, removeNote } from "#/orpc/note/service";

/*===== Notes =====*/
// Runs against the real database (`DATABASE_URL`, after `pnpm db:push`): ownership is enforced by the queries, which
// only a real table shows. Every row is created per run and removed afterwards.

const runId = randomUUID().slice(0, 8);
const owner = `test-note-owner-${runId}`;
const stranger = `test-note-stranger-${runId}`;
const strangersImage = randomUUID();

beforeAll(async () => {
  await db.insert(user).values([owner, stranger].map((id) => ({ id, name: "Test user", email: `${id}@example.test` })));
  // A row is enough: attaching never touches the bucket.
  await db.insert(media).values({
    id: strangersImage,
    kind: "image",
    uploadedBy: stranger,
    width: 10,
    height: 10,
    placeholder: "data:,",
  });
});

afterAll(async () => {
  await db.delete(note).where(inArray(note.ownerId, [owner, stranger]));
  await db.delete(media).where(inArray(media.uploadedBy, [owner, stranger]));
  await db.delete(user).where(inArray(user.id, [owner, stranger]));
  await db.$client.end();
});

describe("notes", () => {
  it("stores a trimmed note and lists it only for its owner", async () => {
    const result = await addNote({ db, ownerId: owner, input: { title: "  خرید  ", body: "نان" } });
    expect(result).toMatchObject({ kind: "success", note: { title: "خرید", body: "نان", image: null } });

    expect((await listNotes({ db, ownerId: owner })).map((item) => item.title)).toEqual(["خرید"]);
    expect(await listNotes({ db, ownerId: stranger })).toEqual([]);
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
});
