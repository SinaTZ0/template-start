import sharp from "sharp";

import { MEDIA_MAX_BYTES, MEDIA_VARIANTS } from "#/orpc/media/constants";
import type { MediaKind, MediaVariantSpec } from "#/orpc/media/constants";
import { m } from "#/paraglide/messages";

/*===== Limits =====*/
const MAX_PIXELS = 40_000_000;
const ACCEPTED_FORMATS = ["jpeg", "png", "webp"];

/**
 * Transparency is flattened onto this so a PNG cut-out doesn't turn black: the light theme's `--background`
 * (`src/styles.css`) as hex, since sharp can't read the token. Change it with the theme.
 */
const FLATTEN_BACKGROUND = "#FFFFFF";

const WEBP_QUALITY = 80;
const WEBP_THUMB_QUALITY = 72;
const WEBP_EFFORT = 4;

/*===== Rejections =====*/
/** Why an upload was refused. */
export type ImageRejection = "tooBig" | "tooManyPixels" | "unsupported" | "unreadable";

/**
 * The user-facing message for a rejection, shown as the `file` field error. Called by the procedure that maps the
 * rejection, so it is in that request's locale.
 */
export const IMAGE_REJECTION_TEXT: Record<ImageRejection, () => string> = {
  tooBig: () => m.media_error_too_big({ max: MEDIA_MAX_BYTES / 1024 / 1024 }),
  tooManyPixels: m.media_error_too_many_pixels,
  unsupported: m.media_error_unsupported,
  unreadable: m.media_error_unreadable,
};

/*===== Types =====*/
export type ProcessedVariant = { name: string; body: Buffer };

export type ProcessedImage = {
  /** Of the original after rotation. */
  width: number;
  height: number;
  /** Data URI of a 16 px wide WebP. */
  placeholder: string;
  variants: ProcessedVariant[];
};

export type ProcessImageResult =
  { kind: "success"; image: ProcessedImage } | { kind: "invalid"; reason: ImageRejection };

/*===== Process =====*/
/**
 * Checks an uploaded file and converts it to the kind's WebP variants plus a placeholder.
 *
 * The real format is read by sharp, never taken from the file name or `Content-Type`. The image is rotated by its EXIF
 * orientation and every piece of metadata is dropped (phone photos carry GPS), converted to sRGB and, except for
 * avatars, flattened onto `FLATTEN_BACKGROUND`.
 *
 * @returns `invalid` with the reason when the file is too big, not a JPEG, PNG or WebP (HEIC included), or can't be
 * decoded.
 */
export async function processImage({ file, kind }: { file: File; kind: MediaKind }): Promise<ProcessImageResult> {
  /*------ Size, Before Decoding ------*/
  if (file.size > MEDIA_MAX_BYTES) return { kind: "invalid", reason: "tooBig" };

  const input = Buffer.from(await file.arrayBuffer());

  try {
    /*------ Real Format ------*/
    // `limitInputPixels` also guards the decoder itself; the explicit check gives a readable message.
    const options = { limitInputPixels: MAX_PIXELS };
    const metadata = await sharp(input, options).metadata();

    if (!metadata.format || !ACCEPTED_FORMATS.includes(metadata.format)) {
      return { kind: "invalid", reason: "unsupported" };
    }
    if (!metadata.width || !metadata.height) return { kind: "invalid", reason: "unreadable" };
    if (metadata.width * metadata.height > MAX_PIXELS) return { kind: "invalid", reason: "tooManyPixels" };

    // EXIF orientations 5 to 8 turn the image by a quarter, which swaps its sides.
    const turned = (metadata.orientation ?? 1) >= 5;
    const width = turned ? metadata.height : metadata.width;
    const height = turned ? metadata.width : metadata.height;

    /*------ Shared Pipeline ------*/
    // `rotate()` applies the orientation. WebP output carries no metadata unless asked to, so EXIF/GPS never survives.
    let base = sharp(input, options).rotate().toColorspace("srgb");
    if (kind !== "avatar") base = base.flatten({ background: FLATTEN_BACKGROUND });

    /*------ Variants ------*/
    const specs: [string, MediaVariantSpec][] = Object.entries<MediaVariantSpec>(MEDIA_VARIANTS[kind]);
    const variants = await Promise.all(
      specs.map(async ([name, spec]) => ({
        name,
        body: await base
          .clone()
          .resize({
            width: spec.width,
            height: spec.height,
            fit: spec.mode === "cover" ? "cover" : "inside",
            // Picks the most interesting part when cropping.
            position: spec.mode === "cover" ? sharp.strategy.attention : undefined,
            withoutEnlargement: spec.mode === "inside",
          })
          .webp({ quality: name === "thumb" ? WEBP_THUMB_QUALITY : WEBP_QUALITY, effort: WEBP_EFFORT })
          .toBuffer(),
      })),
    );

    /*------ Placeholder ------*/
    const tiny = await base.clone().resize({ width: 16 }).webp({ quality: 50, effort: WEBP_EFFORT }).toBuffer();

    return {
      kind: "success",
      image: { width, height, placeholder: `data:image/webp;base64,${tiny.toString("base64")}`, variants },
    };
  } catch (error) {
    // A file sharp can't decode (truncated, not an image at all, over the pixel limit) is the uploader's problem.
    const reason = error instanceof Error ? error.message : "";
    if (/pixel limit/i.test(reason)) return { kind: "invalid", reason: "tooManyPixels" };
    // A format libvips has no loader for. HEIC from a phone is an ISO media file (`ftyp` box) that it may not even name.
    const isIsoMedia = input.subarray(4, 8).toString("latin1") === "ftyp";
    if (isIsoMedia || /unsupported image format/i.test(reason)) {
      return { kind: "invalid", reason: "unsupported" };
    }
    return { kind: "invalid", reason: "unreadable" };
  }
}
