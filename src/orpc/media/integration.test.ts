import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { Data, Effect, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { media, user } from "#/db/schema";
import { MEDIA_ATTACH_WINDOW_MS, ORPHANED_MEDIA_AGE_MS } from "#/orpc/media/constants";
import { MediaUnusable } from "#/orpc/media/errors";
import { DiscardMedia } from "#/orpc/media/jobs.server";
import { MediaRepo } from "#/orpc/media/repository";
import { MediaService } from "#/orpc/media/service";
import { Db } from "#/server/db.server";
import { AppLayer } from "#/server/runtime.server";
import type { AppServices } from "#/server/runtime.server";

/*===== Media =====*/
// Runs against the real database (`DATABASE_URL`, after `pnpm db:migrate`) on the app's own layers. Only rows, the scan
// and the queue are tested: running the cleanup itself would delete the database's other orphans too.

const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const failure = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(Effect.flip(effect));
const query = <A>(f: (q: Db["Service"]["q"]) => Effect.Effect<A, unknown>) =>
  Db.use(({ q }) => f(q).pipe(Effect.orDie));

class EntityWriteFailed extends Data.TaggedError("EntityWriteFailed") {}

const HOUR_MS = 60 * 60 * 1000;
const now = Date.now();
const owner = `test-media-owner-${randomUUID().slice(0, 8)}`;

const ids = { fresh: randomUUID(), old: randomUUID(), oldAttached: randomUUID(), expired: randomUUID() };

function mediaRow({ id, ageMs, attached }: { id: string; ageMs: number; attached: boolean }) {
  const createdAt = new Date(now - ageMs);
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

const attach = (mediaId: string) =>
  MediaService.use((service) => service.attach({ mediaId, kind: "image", userId: owner }));

/** How many runs of `media.discard` are queued for a media. */
async function queuedDiscards(mediaId: string): Promise<number> {
  const result = await run(
    query((q) =>
      q.execute<{ total: number }>(
        sql`select count(*)::int as total from effect_queue where queue_name = ${DiscardMedia.name} and element::text like ${`%${mediaId}%`}`,
      ),
    ),
  );
  return result.rows[0]?.total ?? 0;
}

beforeAll(async () => {
  await run(query((q) => q.insert(user).values({ id: owner, name: "Test user", email: `${owner}@example.test` })));
  await run(
    query((q) =>
      q
        .insert(media)
        .values([
          mediaRow({ id: ids.fresh, ageMs: HOUR_MS, attached: false }),
          mediaRow({ id: ids.old, ageMs: ORPHANED_MEDIA_AGE_MS + HOUR_MS, attached: false }),
          mediaRow({ id: ids.oldAttached, ageMs: ORPHANED_MEDIA_AGE_MS + HOUR_MS, attached: true }),
          mediaRow({ id: ids.expired, ageMs: MEDIA_ATTACH_WINDOW_MS + 10 * 60 * 1000, attached: false }),
        ]),
    ),
  );
});

afterAll(async () => {
  await run(query((q) => q.delete(media).where(eq(media.uploadedBy, owner))));
  await run(query((q) => q.delete(user).where(eq(user.id, owner))));
  await runtime.dispose();
});

describe("media", () => {
  it("finds only unattached uploads past the orphan age", async () => {
    const found = await run(
      MediaRepo.use((repo) =>
        repo.findOrphanedIds({ uploadedBefore: new Date(now - ORPHANED_MEDIA_AGE_MS), limit: 10_000 }),
      ),
    );
    const ours = found.filter((id) => (Object.values(ids) as string[]).includes(id));
    expect(ours).toEqual([ids.old]);
  });

  it("refuses to attach an upload past the attach window, but not a fresh one", async () => {
    expect(await failure(attach(ids.expired))).toBeInstanceOf(MediaUnusable);
    await run(attach(ids.fresh));
    // A second time it is refused, so two entities never share it.
    expect(await failure(attach(ids.fresh))).toBeInstanceOf(MediaUnusable);
  });

  it("releases a media and queues its deletion only if the entity's change commits", async () => {
    // `fresh` was attached above. A change that fails takes the release, and the queued deletion, back with it.
    const failedChange = Db.use((db) =>
      db.transaction(
        Effect.gen(function* () {
          yield* MediaService.use((service) => service.release(ids.fresh));
          return yield* new EntityWriteFailed();
        }),
      ),
    );
    expect(await failure(failedChange)).toBeInstanceOf(EntityWriteFailed);
    const [row] = await run(query((q) => q.select().from(media).where(eq(media.id, ids.fresh))));
    expect(row?.attachedAt).toBeInstanceOf(Date);
    expect(await queuedDiscards(ids.fresh)).toBe(0);

    // A change that commits: released, and its deletion queued with it.
    await run(Db.use((db) => db.transaction(MediaService.use((service) => service.release(ids.fresh)))));
    expect(await queuedDiscards(ids.fresh)).toBe(1);
  });

  it("never deletes a media that is attached again by the time the deletion runs", async () => {
    await run(MediaRepo.use((repo) => repo.claim(ids.fresh)));
    await run(DiscardMedia.run({ mediaId: ids.fresh }));
    const [row] = await run(query((q) => q.select().from(media).where(eq(media.id, ids.fresh))));
    expect(row?.attachedAt).toBeInstanceOf(Date);
  });
});
