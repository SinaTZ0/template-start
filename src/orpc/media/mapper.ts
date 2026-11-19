import { Schema } from "effect";

import { MEDIA_KINDS, MEDIA_VARIANTS } from "#/orpc/media/constants";
import type { MediaKind } from "#/orpc/media/constants";
import type { Media } from "#/orpc/media/contract";
import type { MediaRecord } from "#/orpc/media/repository";

/*===== Public Media =====*/
/**
 * Converts a stored media row into its public shape: drops `uploadedBy` and the timestamps, and adds a public URL for
 * each of the kind's variants, under `publicUrl` (`AppConfig.mediaPublicUrl`).
 *
 * @throws When `kind` isn't a known value. The service only writes valid kinds, so this means corrupted data that
 * should surface instead of producing an image with no URLs.
 */
export function toPublicMedia({ record, publicUrl }: { record: MediaRecord; publicUrl: string }): Media {
  if (!isMediaKind(record.kind)) throw new Error(`Media ${record.id} has an unknown kind: ${record.kind}`);
  const kind = record.kind;

  return {
    id: record.id,
    kind,
    width: record.width,
    height: record.height,
    placeholder: record.placeholder,
    urls: Object.fromEntries(
      Object.keys(MEDIA_VARIANTS[kind]).map((variant) => [
        variant,
        `${publicUrl}/${mediaKey({ kind, mediaId: record.id, variant })}`,
      ]),
    ),
  };
}

/*===== Type Guards =====*/
export function isMediaKind(value: string): value is MediaKind {
  return (MEDIA_KINDS as readonly string[]).includes(value);
}

/*===== IDs and Keys =====*/
/** The bucket key of one variant: `{kind}/{mediaId}/{variant}.webp`. Public URLs are this under `MEDIA_PUBLIC_URL`. */
export function mediaKey({ kind, mediaId, variant }: { kind: MediaKind; mediaId: string; variant: string }): string {
  return `${kind}/${mediaId}/${variant}.webp`;
}

/** Whether the text can be a media ID. A malformed one would make Postgres throw, so callers treat it as unknown. */
export const isMediaId = Schema.is(Schema.String.check(Schema.isUUID()));

/** Every bucket key of a media's variants. */
export function variantKeys({ kind, mediaId }: { kind: MediaKind; mediaId: string }): string[] {
  return Object.keys(MEDIA_VARIANTS[kind]).map((variant) => mediaKey({ kind, mediaId, variant }));
}
