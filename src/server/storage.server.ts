import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Context, Effect, Layer, Redacted } from "effect";

import { AppConfig } from "#/server/config.server";

/*===== Storage =====*/
/**
 * How long one call to the bucket may take. The SDK sets no limit of its own, so a bucket that stops answering would
 * hold an upload's request, or the job deleting files, for as long as the connection stays open. Far above a healthy
 * call: the largest object is one processed image.
 */
const CALL_TIMEOUT = "30 seconds";

/**
 * The S3-compatible bucket uploads live in (docs/backend/media.md). A failing bucket is a defect, and so is one that
 * doesn't answer within `CALL_TIMEOUT`: a request reports it, a job retries. Each call is a `Storage.*` span.
 */
export class Storage extends Context.Service<
  Storage,
  {
    /** Puts one object, cached forever: a media key never changes content (a replaced image gets a new ID). */
    readonly put: (object: { key: string; body: Buffer; contentType: string }) => Effect.Effect<void>;
    /** Deletes objects. A key that doesn't exist counts as deleted, so a retry is safe. */
    readonly deleteMany: (keys: ReadonlyArray<string>) => Effect.Effect<void>;
  }
>()("app/server/Storage") {
  static readonly layer = Layer.effect(
    Storage,
    Effect.gen(function* () {
      const { s3 } = yield* AppConfig;
      const client = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new S3Client({
              endpoint: s3.endpoint,
              region: s3.region,
              credentials: { accessKeyId: Redacted.value(s3.accessKey), secretAccessKey: Redacted.value(s3.secretKey) },
              // SeaweedFS (and most self-hosted stores) serve buckets by path (`/<bucket>/...`), not by subdomain.
              forcePathStyle: true,
              // The SDK's default checksums add headers that S3-compatible stores don't all accept; send them only
              // when required.
              requestChecksumCalculation: "WHEN_REQUIRED",
              responseChecksumValidation: "WHEN_REQUIRED",
            }),
        ),
        (opened) => Effect.sync(() => opened.destroy()),
      );

      const put = Effect.fn("Storage.put")(
        function* ({ key, body, contentType }: { key: string; body: Buffer; contentType: string }) {
          yield* Effect.promise((signal) =>
            client.send(
              new PutObjectCommand({
                Bucket: s3.bucket,
                Key: key,
                Body: body,
                ContentType: contentType,
                CacheControl: "public, max-age=31536000, immutable",
              }),
              { abortSignal: signal },
            ),
          );
        },
        // The timeout interrupts the call, which aborts the request through its signal.
        Effect.timeout(CALL_TIMEOUT),
        Effect.orDie,
      );

      const deleteMany = Effect.fn("Storage.deleteMany")(
        function* (keys: ReadonlyArray<string>) {
          if (keys.length === 0) return;
          const result = yield* Effect.promise((signal) =>
            client.send(
              new DeleteObjectsCommand({
                Bucket: s3.bucket,
                Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
              }),
              { abortSignal: signal },
            ),
          );
          if (result.Errors?.length) {
            return yield* Effect.die(
              new Error(
                `Could not delete ${result.Errors.length} object(s): ${result.Errors[0]?.Message ?? "unknown"}`,
              ),
            );
          }
        },
        Effect.timeout(CALL_TIMEOUT),
        Effect.orDie,
      );

      return Storage.of({ put, deleteMany });
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
