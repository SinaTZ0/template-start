# Media (Images)

How the app stores, processes and serves uploaded images.

## Overview

```text
upload:  browser ──multipart──▶ React Router (oRPC media.upload) ──sharp──▶ WebP variants ──S3 PUT──▶ bucket
serve:   browser ──GET <MEDIA_PUBLIC_URL>/…──▶ (production: Caddy) ──▶ bucket (read-only, files only)
```

- **Any S3-compatible store.** Development uses SeaweedFS from `compose.dev.yaml`. The code only speaks the S3 API
  (`@aws-sdk/client-s3`, `app/lib/storage.server.ts`), so the store can change without code changes.
- **The app writes.** Uploads go through the server, which checks, converts and resizes the image, then puts every
  variant into the bucket. Users never write to the bucket directly.
- **Browsers read** straight from the bucket in development, and through a read-only proxy path (`/media`) in
  production.
- The original upload is never stored. Only the generated WebP variants are.

## Image Kinds and Variants

Each kind has a fixed set of variants, generated once at upload (`app/orpc/media/constants.ts`).

- **cover** crops to exactly the given size, keeping the most interesting part of the image (sharp's `attention`).
- **inside** fits the image inside the box and keeps its aspect ratio. It never upscales.

| Kind     | Variant | Mode   | Size (px)   |
| -------- | ------- | ------ | ----------- |
| `avatar` | `thumb` | cover  | 96 × 96     |
|          | `md`    | cover  | 320 × 320   |
| `image`  | `thumb` | cover  | 320 × 240   |
|          | `card`  | cover  | 800 × 600   |
|          | `full`  | inside | 1600 × 1600 |

Sizes are about twice the largest CSS size each one is shown at. Add a kind when a new use needs different variants,
and allow it per role in `MEDIA_UPLOAD_KINDS_BY_ROLE`.

Every image also gets a **placeholder**: a 16 px wide WebP stored inline in the database as a data URI (about 200
bytes), shown blurred while the real image loads.

## Processing Rules

All processing uses [sharp](https://sharp.pixelplumbing.com/) (`processing.server.ts`).

1. **Limits:** at most **10 MB** per file and **40 megapixels**. Larger files are rejected before decoding.
2. **Check the real type** with sharp, never the file name or `Content-Type`. Accept `jpeg`, `png` and `webp`; reject
   everything else (HEIC included) with a Persian message.
3. **Rotate** by the EXIF orientation, then **drop all metadata**: phone photos carry GPS location.
4. **Convert to sRGB** and **flatten transparency** onto `FLATTEN_BACKGROUND`, except avatars.
5. **Encode WebP** at quality 80 (`thumb`: 72), `effort: 4`.

## Storage Keys and URLs

```text
{kind}/{mediaId}/{variant}.webp        e.g. image/7f3c…/card.webp
```

`mediaId` is a fresh UUID per upload, so a URL never changes content and is cached forever
(`Cache-Control: public, max-age=31536000, immutable`). URLs are built from `MEDIA_PUBLIC_URL`.

## Database and Upload Flow

One `media` table records every upload (`app/db/schema.ts`). Entities point to it with a nullable foreign key
(`on delete set null`), e.g. `note.imageMediaId`.

1. The form uploads the file as soon as it's picked, through `media.upload` (`kind` + `File`). Only signed-in users,
   and only the kinds their role may upload.
2. The server writes every variant, then inserts the row, and returns its ID, URLs and placeholder. If a write fails
   halfway, the variants already written are deleted, so a row only exists when all its variants do.
3. Saving the form sends the media ID. The entity's service calls `attachMedia`, which checks the kind and the
   uploader and sets `attachedAt`. An upload can only be attached within 24 hours (`MEDIA_ATTACH_WINDOW_MS`); after
   that the form shows the image as unusable and the user picks it again.
4. When an entity is deleted or its image replaced, the service calls `deleteMedia` (bucket first, then the row). The
   cleanup below never sees a replaced image, because it is still marked attached, so the service must delete it.
5. **Cleanup:** uploads whose form was never saved are orphans. `startMediaCleanup` (`app/orpc/media/cleanup.server.ts`),
   started from `entry.server.tsx`, runs `deleteOrphanedMedia` hourly in the app's process. It deletes media still
   unattached 25 hours after upload (`ORPHANED_MEDIA_AGE_MS`), up to 200 per run, through `deleteMedia`. The extra hour
   past the attach window means a save and the cleanup can never race. The `attached_at, created_at` index serves the
   scan.

## Rendering

`MediaImage` (`app/components/shared/media-image/`) takes the media and a variant name and renders an `<img>` with its
intrinsic `width` and `height` (no layout shift), `loading="lazy"` unless `priority`, and the blurred placeholder as
its background. `alt` text is required.

## Production

`compose.prod.yaml` runs SeaweedFS with no published ports and serves the bucket read-only behind the app's own origin
through Caddy (`deploy/Caddyfile`, docs/deployment.md):

- Only `GET`/`HEAD` of a path shaped like `/media/{kind}/{mediaId}/{variant}.webp` reaches the store. That shape blocks
  bucket listing and every other S3 operation, and the query string is dropped. Anything else under `/media` is a 404.
- Visitors' `Authorization` and `Cookie` headers are never forwarded. Reads use the store's `anonymous` identity, which
  may only read the bucket.
- The app writes with its own identity (read and write on its bucket only). Creating the bucket needs the `admin`
  identity, which only the one-time `storage-init` job gets.
- Files keep the `Cache-Control: immutable` they were uploaded with: a media key never changes content.

## Configuration

| Variable           | Development (`compose.dev.yaml`)  | Production                |
| ------------------ | --------------------------------- | ------------------------- |
| `S3_ENDPOINT`      | `http://localhost:8333`           | `http://seaweedfs:8333`   |
| `S3_BUCKET_NAME`   | `app-media`                       | the project's bucket      |
| `S3_ACCESS_KEY`    | any (S3 auth is off locally)      | the app's identity key    |
| `S3_SECRET_KEY`    | any                               | the app's identity secret |
| `S3_REGION`        | `us-east-1`                       | `us-east-1`               |
| `MEDIA_PUBLIC_URL` | `http://localhost:8333/app-media` | `/media`                  |
