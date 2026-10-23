import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "#/env.server";
import { span } from "#/lib/trace.server";
import type { MediaKind } from "#/orpc/media/constants";

/*===== S3 Client =====*/
let client: S3Client | undefined;

/** Created on first use, so importing this module never opens a connection. */
function getClient(): S3Client {
  client ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    // SeaweedFS (and most self-hosted stores) serve buckets by path (`/<bucket>/...`), not by subdomain.
    forcePathStyle: true,
    // The SDK's default checksums add headers that S3-compatible stores don't all accept; send them only when required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  // Every command becomes a `storage` span of the current request (e.g. `PutObject`), retries included.
  client.middlewareStack.add(
    (next, context) => (args) =>
      span({ kind: "storage", name: (context.commandName ?? "S3").replace(/Command$/, "") }, () => next(args)),
    { step: "initialize", name: "traceStorage" },
  );
  return client;
}

/*===== Keys and URLs =====*/
/** The bucket key of one variant: `{kind}/{mediaId}/{variant}.webp`. */
export function mediaKey({ kind, mediaId, variant }: { kind: MediaKind; mediaId: string; variant: string }): string {
  return `${kind}/${mediaId}/${variant}.webp`;
}

/** The public URL of one variant, under `MEDIA_PUBLIC_URL` (SeaweedFS in development, Caddy's `/media` in production). */
export function mediaUrl({ kind, mediaId, variant }: { kind: MediaKind; mediaId: string; variant: string }): string {
  return `${env.MEDIA_PUBLIC_URL.replace(/\/+$/, "")}/${mediaKey({ kind, mediaId, variant })}`;
}

/*===== Writes =====*/
/**
 * Puts one object into the bucket.
 *
 * @param cacheControl Defaults to forever: a media key never changes content (a replaced image gets a new ID).
 */
export async function putObject({
  key,
  body,
  contentType,
  cacheControl = "public, max-age=31536000, immutable",
}: {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
}): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
}

/**
 * Deletes objects from the bucket. A key that doesn't exist counts as deleted, so a retry is safe.
 *
 * @throws When the store reports any key it could not delete.
 */
export async function deleteObjects({ keys }: { keys: string[] }): Promise<void> {
  if (keys.length === 0) return;

  const result = await getClient().send(
    new DeleteObjectsCommand({
      Bucket: env.S3_BUCKET_NAME,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );

  if (result.Errors?.length) {
    throw new Error(`Could not delete ${result.Errors.length} object(s): ${result.Errors[0]?.Message ?? "unknown"}`);
  }
}
