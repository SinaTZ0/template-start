import { randomUUID } from "node:crypto";

import { expect, layer } from "@effect/vitest";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

import { media, user } from "#/db/schema";
import { MEDIA_ATTACH_WINDOW_MS, ORPHANED_MEDIA_AGE_MS } from "#/orpc/media/constants";
import { MediaUnusable } from "#/orpc/media/errors";
import { DiscardMedia } from "#/orpc/media/jobs.server";
import { MediaRepo } from "#/orpc/media/repository";
import { MediaService } from "#/orpc/media/service";
import { Db } from "#/server/db.server";
import { AppLayer } from "#/server/runtime.server";

/*===== Media =====*/
// Runs against the real database (`DATABASE_URL`, after `pnpm db:migrate`) on the app's own layers. Only rows, the scan
// and the queue are tested: running the cleanup itself would delete the database's other orphans too.

const query = <A>(f: (q: Db["Service"]["q"]) => Effect.Effect<A, unknown>) =>
  Db.use(({ q }) => f(q).pipe(Effect.orDie));

class EntityWriteFailed extends Schema.TaggedError<EntityWriteFailed>()("EntityWriteFailed", {}) {}

const HOUR_MS = 60 * 60 * 1000;
const now = Date.now();
const orphanedBefore = new Date(now - ORPHANED_MEDIA_AGE_MS);
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

/** When a media was attached; undefined for one that is unattached or deleted. */
const attachedAt = (mediaId: string) =>
  query((q) => q.select().from(media).where(eq(media.id, mediaId))).pipe(Effect.map(([row]) => row?.attachedAt));

/** How many runs of `media.discard` are queued for a media. */
const queuedDiscards = (mediaId: string) =>
  query((q) =>
    q.execute<{ total: number }>(
      sql`select count(*)::int as total from effect_queue where queue_name = ${DiscardMedia.name} and element::text like ${`%${mediaId}%`}`,
    ),
  ).pipe(Effect.map((result) => result.rows[0]?.total ?? 0));

/*===== Fixtures =====*/
/** This run's user and uploads: created when the layer is built, removed when it closes. */
const Fixtures = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.gen(function* () {
      yield* query((q) => q.insert(user).values({ id: owner, name: "Test user", email: `${owner}@example.test` }));
      yield* query((q) =>
        q
          .insert(media)
          .values([
            mediaRow({ id: ids.fresh, ageMs: HOUR_MS, attached: false }),
            mediaRow({ id: ids.old, ageMs: ORPHANED_MEDIA_AGE_MS + HOUR_MS, attached: false }),
            mediaRow({ id: ids.oldAttached, ageMs: ORPHANED_MEDIA_AGE_MS + HOUR_MS, attached: true }),
            mediaRow({ id: ids.expired, ageMs: MEDIA_ATTACH_WINDOW_MS + 10 * 60 * 1000, attached: false }),
          ]),
      );
    }),
    () =>
      Effect.gen(function* () {
        yield* query((q) => q.delete(media).where(eq(media.uploadedBy, owner)));
        yield* query((q) => q.delete(user).where(eq(user.id, owner)));
      }),
  ),
);

/*===== Tests =====*/
// On the real clock (`excludeTestServices`): the attach window is measured against the rows' real timestamps. The tests
// share the rows and run in order: each one starts from what the one before left.
layer(Fixtures.pipe(Layer.provideMerge(AppLayer)), { excludeTestServices: true })("media", (it) => {
  it.effect("finds only unattached uploads past the orphan age", () =>
    Effect.gen(function* () {
      const repo = yield* MediaRepo;
      const found = yield* repo.findOrphanedIds({ uploadedBefore: orphanedBefore, limit: 10_000 });
      const ours = found.filter((id) => (Object.values(ids) as string[]).includes(id));
      expect(ours).toEqual([ids.old]);
    }),
  );

  it.effect("refuses to attach an upload past the attach window, but not a fresh one", () =>
    Effect.gen(function* () {
      const service = yield* MediaService;
      const attach = (mediaId: string) => service.attach({ mediaId, kind: "image", userId: owner });

      expect(yield* Effect.flip(attach(ids.expired))).toBeInstanceOf(MediaUnusable);
      yield* attach(ids.fresh);
      // A second time it is refused, so two entities never share it.
      expect(yield* Effect.flip(attach(ids.fresh))).toBeInstanceOf(MediaUnusable);
    }),
  );

  it.effect("releases a media and queues its deletion only if the entity's change commits", () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const service = yield* MediaService;

      // `fresh` was attached above. A change that fails takes the release, and the queued deletion, back with it.
      const failedChange = db.transaction(
        Effect.gen(function* () {
          yield* service.release(ids.fresh);
          return yield* new EntityWriteFailed();
        }),
      );
      expect(yield* Effect.flip(failedChange)).toBeInstanceOf(EntityWriteFailed);
      expect(yield* attachedAt(ids.fresh)).toBeInstanceOf(Date);
      expect(yield* queuedDiscards(ids.fresh)).toBe(0);

      // A change that commits: released, and its deletion queued with it.
      yield* db.transaction(service.release(ids.fresh));
      expect(yield* queuedDiscards(ids.fresh)).toBe(1);
    }),
  );

  it.effect("never deletes a media that is attached again by the time the deletion runs", () =>
    Effect.gen(function* () {
      const repo = yield* MediaRepo;
      yield* repo.claim(ids.fresh);
      yield* DiscardMedia.run({ mediaId: ids.fresh });
      expect(yield* attachedAt(ids.fresh)).toBeInstanceOf(Date);
    }),
  );
});
