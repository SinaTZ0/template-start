/*===== Media Bucket =====*/
// Creates the media bucket if it doesn't exist; safe to run on every start. Used by `pnpm services` in development and
// by the `storage-init` service in production, with the store's admin identity (the app's own identity can't create
// buckets). Plain JavaScript on runtime packages only, like `migrate.mjs`.
import { setTimeout } from "node:timers/promises";

import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 2_000;

const bucket = process.env.S3_BUCKET_NAME;
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
  // Same settings as `src/lib/storage.server.ts`: path-style buckets, checksums only when required.
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

/** Creates the bucket unless it is already there. */
async function ensureBucket() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 404) throw error;
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (createError) {
      // Another run created it in the meantime.
      if (createError.name !== "BucketAlreadyOwnedByYou") throw createError;
    }
  }
}

try {
  // The store's S3 gateway starts answering a few seconds after its container does.
  for (let attempt = 1; ; attempt++) {
    try {
      await ensureBucket();
      break;
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw error;
      await setTimeout(RETRY_DELAY_MS);
    }
  }
  console.log(`Media bucket ${bucket} is ready.`);
} finally {
  client.destroy();
}
