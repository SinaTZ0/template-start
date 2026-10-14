# Media (Images)

How the app stores, processes and serves uploaded images.

## Overview

```text
upload:  browser ──multipart──▶ React Router (oRPC media.upload) ──sharp──▶ WebP variants ──S3 PUT──▶ bucket
serve:   browser ──GET <MEDIA_PUBLIC_URL>/…──▶ (production: nginx) ──▶ bucket (read-only, files only)
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
   uploader and sets `attachedAt`.
4. When an entity is deleted or its image replaced, the service calls `deleteMedia` (bucket first, then the row).
5. **Cleanup (not built):** a scheduled job should delete media still unattached 24 hours after upload (forms never
   saved) with `deleteMedia`. The `attached_at, created_at` index serves that scan.

## Rendering

`MediaImage` (`app/components/shared/media-image/`) takes the media and a variant name and renders an `<img>` with its
intrinsic `width` and `height` (no layout shift), `loading="lazy"` unless `priority`, and the blurred placeholder as
its background. `alt` text is required.

## Production

Serve the bucket read-only behind the app's own origin, e.g. with nginx:

```nginx
# `proxy_pass` with a variable resolves the host per request, so nginx needs Docker's DNS.
resolver 127.0.0.11 valid=30s;

# Only image files: blocks bucket listing and every write method.
location ~ ^/media/([a-z]+/[0-9a-f-]{36}/[a-z]+\.webp)$ {
  limit_except GET HEAD { deny all; }
  proxy_pass http://seaweedfs:8333/<bucket>/$1;
  proxy_hide_header x-amz-request-id;
  proxy_hide_header x-amz-id-2;
  add_header Cache-Control "public, max-age=31536000, immutable";
}
location /media/ { return 404; }
```

In production the store should publish no ports, give the app its own S3 identity (read and write on the bucket) and
allow anonymous reads only, and pin an image version.

## Configuration

| Variable           | Development (`compose.dev.yaml`)  | Production                |
| ------------------ | --------------------------------- | ------------------------- |
| `S3_ENDPOINT`      | `http://localhost:8333`           | the store's internal URL  |
| `S3_BUCKET_NAME`   | `app-media`                       | the project's bucket      |
| `S3_ACCESS_KEY`    | any (S3 auth is off locally)      | the app's identity key    |
| `S3_SECRET_KEY`    | any                               | the app's identity secret |
| `S3_REGION`        | `us-east-1`                       | `us-east-1`               |
| `MEDIA_PUBLIC_URL` | `http://localhost:8333/app-media` | `/media`                  |
