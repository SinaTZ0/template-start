import { Context, Effect, Layer } from "effect";

import { deleteObjects, putObject } from "#/lib/storage.server";

/*===== Storage =====*/
/**
 * The S3-compatible bucket uploads live in (docs/backend/media.md). A failing bucket is a defect: a request reports it,
 * a job retries.
 *
 * The S3 client times each command as a `storage` span of the request already, so these add none of their own.
 */
export class Storage extends Context.Service<
  Storage,
  {
    /** Puts one object; `cacheControl` defaults to forever, since a media key never changes content. */
    readonly put: (object: { key: string; body: Buffer; contentType: string }) => Effect.Effect<void>;
    /** Deletes objects. A key that doesn't exist counts as deleted, so a retry is safe. */
    readonly deleteMany: (keys: ReadonlyArray<string>) => Effect.Effect<void>;
  }
>()("app/server/Storage") {
  static readonly layer = Layer.succeed(
    Storage,
    Storage.of({
      put: (object) => Effect.promise(() => putObject(object)),
      deleteMany: (keys) => Effect.promise(() => deleteObjects({ keys: [...keys] })),
    }),
  );

  /** A bucket in memory, for tests: what was put, and nothing that was deleted. */
  static readonly layerMemory = Layer.sync(Storage, () => {
    const objects = new Map<string, Buffer>();
    return Storage.of({
      put: ({ key, body }) => Effect.sync(() => void objects.set(key, body)),
      deleteMany: (keys) => Effect.sync(() => keys.forEach((key) => objects.delete(key))),
    });
  });
}
