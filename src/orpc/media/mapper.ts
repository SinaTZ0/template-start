import { MEDIA_KINDS, MEDIA_VARIANTS } from "#/orpc/media/constants";
import type { MediaKind } from "#/orpc/media/constants";
import type { Media } from "#/orpc/media/contract";
import type { MediaRecord } from "#/orpc/media/repository";
import { mediaUrl } from "#/lib/storage.server";

/*===== Public Media =====*/
/**
 * Converts a stored media row into its public shape: drops `uploadedBy` and the timestamps, and adds a public URL for
 * each of the kind's variants.
 *
 * @throws When `kind` isn't a known value. The service only writes valid kinds, so this means corrupted data that
 * should surface instead of producing an image with no URLs.
 */
export function toPublicMedia(record: MediaRecord): Media {
  if (!isMediaKind(record.kind)) throw new Error(`Media ${record.id} has an unknown kind: ${record.kind}`);
  const kind = record.kind;

  return {
    id: record.id,
    kind,
    width: record.width,
    height: record.height,
    placeholder: record.placeholder,
    urls: Object.fromEntries(
      Object.keys(MEDIA_VARIANTS[kind]).map((variant) => [variant, mediaUrl({ kind, mediaId: record.id, variant })]),
    ),
  };
}

/*===== Type Guards =====*/
export function isMediaKind(value: string): value is MediaKind {
  return (MEDIA_KINDS as readonly string[]).includes(value);
}
