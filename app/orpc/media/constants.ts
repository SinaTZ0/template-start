import type { UserRole } from "~/lib/user-constants";

/*===== Media Constants =====*/
// Browser-safe values shared by the upload API, the image component and the forms. See docs/media.md.

/*===== Kinds =====*/
export const MEDIA_KINDS = ["avatar", "image"] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

/*===== Variants =====*/
/**
 * - `cover` crops to exactly `width` × `height`, keeping the most interesting part of the image.
 * - `inside` fits the image in the box, keeping its aspect ratio. It never upscales or stretches.
 */
export type MediaVariantSpec = { mode: "cover" | "inside"; width: number; height: number };

/**
 * The fixed set of variants per kind, generated once at upload. Sizes are about twice the largest CSS size each one is
 * shown at, so they stay sharp on high-density screens.
 */
export const MEDIA_VARIANTS = {
  avatar: {
    thumb: { mode: "cover", width: 96, height: 96 },
    md: { mode: "cover", width: 320, height: 320 },
  },
  // A general content image, such as a note's picture. Add a kind per use when the variants differ.
  image: {
    thumb: { mode: "cover", width: 320, height: 240 },
    card: { mode: "cover", width: 800, height: 600 },
    full: { mode: "inside", width: 1600, height: 1600 },
  },
} as const satisfies Record<MediaKind, Record<string, MediaVariantSpec>>;

export type MediaVariantName<Kind extends MediaKind> = keyof (typeof MEDIA_VARIANTS)[Kind] & string;

/** Looks a variant up by name; undefined when the kind has no such variant. */
export function getMediaVariantSpec({
  kind,
  variant,
}: {
  kind: MediaKind;
  variant: string;
}): MediaVariantSpec | undefined {
  const variants: Record<string, MediaVariantSpec> = MEDIA_VARIANTS[kind];
  return variants[variant];
}

/**
 * The pixel size a variant is stored at. `cover` is always its box; `inside` shrinks the original's aspect ratio into
 * the box and never enlarges it (the same rule the processing applies, so `<img>` gets its intrinsic size right).
 */
export function getMediaVariantSize({
  spec,
  mediaWidth,
  mediaHeight,
}: {
  spec: MediaVariantSpec;
  mediaWidth: number;
  mediaHeight: number;
}): { width: number; height: number } {
  if (spec.mode === "cover") return { width: spec.width, height: spec.height };

  const scale = Math.min(spec.width / mediaWidth, spec.height / mediaHeight, 1);
  return { width: Math.max(1, Math.round(mediaWidth * scale)), height: Math.max(1, Math.round(mediaHeight * scale)) };
}

/*===== Upload Limits =====*/
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/** For the file input's `accept`. The server checks the real format, never this. */
export const MEDIA_ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

/*===== Who Uploads What =====*/
/** The kinds each role may upload: only the ones its pages use. */
export const MEDIA_UPLOAD_KINDS_BY_ROLE: Record<UserRole, readonly MediaKind[]> = {
  user: ["avatar", "image"],
  admin: MEDIA_KINDS,
};
