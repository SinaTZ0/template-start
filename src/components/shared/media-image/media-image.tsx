import { cn } from "cn";
import type { CSSProperties } from "react";
import { getMediaVariantSize, getMediaVariantSpec } from "#/orpc/media/constants";
import type { Media } from "#/orpc/media/contract";

/*===== Media Image =====*/
/**
 * Renders one variant of an uploaded image (docs/backend/media.md).
 *
 * The `<img>` carries the variant's intrinsic `width` and `height`, so the browser reserves its space before it loads
 * (no layout shift), and the blurred placeholder shows behind it meanwhile. Size it with CSS (`className`); the
 * intrinsic size only provides the aspect ratio.
 *
 * @param variant A name from the media's kind (`thumb`, `card`, ...). Renders nothing when the media has no such variant.
 * @param alt Persian text describing the image. Pass `""` only when the image is purely decorative.
 * @param priority For an image that is visible without scrolling: loads it right away and at
 * high priority instead of lazily.
 */
export function MediaImage({
  media,
  variant,
  alt,
  className,
  priority = false,
}: {
  media: Media;
  variant: string;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  const src = media.urls[variant];
  const spec = getMediaVariantSpec({ kind: media.kind, variant });
  if (!src || !spec) return null;

  const { width, height } = getMediaVariantSize({ spec, mediaWidth: media.width, mediaHeight: media.height });

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? undefined : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      // The placeholder is a 16 px WebP stretched to fill the box, which is what makes it look blurred. Only its URL
      // is dynamic, so it travels as a custom property and the classes do the styling.
      style={{ "--placeholder": `url("${media.placeholder}")` } as CSSProperties}
      className={cn("bg-(image:--placeholder) bg-cover object-cover", className)}
    />
  );
}
