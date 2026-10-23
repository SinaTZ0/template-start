import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "#/db/client.server";
import { media, user } from "#/db/schema";
import { findOrphanedMediaIds } from "#/orpc/media/repository";
import { attachMedia, MEDIA_ATTACH_WINDOW_MS, ORPHANED_MEDIA_AGE_MS } from "#/orpc/media/service";

/*===== Orphaned Media =====*/
// Runs against the real database (`DATABASE_URL`, after `pnpm db:push`). Only rows and the scan are tested: the
// cleanup's bucket deletes go through `deleteMedia`, and running the cleanup itself would delete the database's other
// orphans too.

const HOUR_MS = 60 * 60 * 1000;
const now = new Date();
const owner = `test-media-owner-${randomUUID().slice(0, 8)}`;

const ids = { fresh: randomUUID(), old: randomUUID(), oldAttached: randomUUID(), expired: randomUUID() };

function mediaRow({ id, ageMs, attached }: { id: string; ageMs: number; attached: boolean }) {
  const createdAt = new Date(now.getTime() - ageMs);
  return {
    id,
    kind: "image",
    uploadedBy: owner,
    width: 10,
    height: 10,
    placeholder: "data:,",
    createdAt,
    attachedAt: attached ? createdAt : null,
  };
}

beforeAll(async () => {
  await db.insert(user).values({ id: owner, name: "Test user", email: `${owner}@example.test` });
  await db
    .insert(media)
    .values([
      mediaRow({ id: ids.fresh, ageMs: HOUR_MS, attached: false }),
      mediaRow({ id: ids.old, ageMs: ORPHANED_MEDIA_AGE_MS + HOUR_MS, attached: false }),
      mediaRow({ id: ids.oldAttached, ageMs: ORPHANED_MEDIA_AGE_MS + HOUR_MS, attached: true }),
      mediaRow({ id: ids.expired, ageMs: MEDIA_ATTACH_WINDOW_MS + 10 * 60 * 1000, attached: false }),
    ]);
});

afterAll(async () => {
  await db.delete(media).where(eq(media.uploadedBy, owner));
  await db.delete(user).where(eq(user.id, owner));
  await db.$client.end();
});

describe("orphaned media", () => {
  it("finds only unattached uploads past the orphan age", async () => {
    const found = await findOrphanedMediaIds({
      db,
      uploadedBefore: new Date(now.getTime() - ORPHANED_MEDIA_AGE_MS),
      limit: 10_000,
    });
    const ours = found.filter((id) => (Object.values(ids) as string[]).includes(id));
    expect(ours).toEqual([ids.old]);
  });

  it("refuses to attach an upload past the attach window, but not a fresh one", async () => {
    const userId = owner;
    expect(await attachMedia({ db, mediaId: ids.expired, kind: "image", userId, now })).toEqual({ kind: "invalid" });
    expect(await attachMedia({ db, mediaId: ids.fresh, kind: "image", userId, now })).toEqual({ kind: "ok" });
  });

  it("refuses to attach an upload a second time, so two entities never share it", async () => {
    const userId = owner;
    expect(await attachMedia({ db, mediaId: ids.fresh, kind: "image", userId, now })).toEqual({ kind: "invalid" });
  });
});
