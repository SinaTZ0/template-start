import { randomUUID } from "node:crypto";

import { Clock, Context, Effect, Layer, Option } from "effect";

import { mediaKey } from "#/lib/storage.server";
import type { UserRole } from "#/lib/user-constants";
import { MEDIA_ATTACH_WINDOW_MS, MEDIA_UPLOAD_KINDS_BY_ROLE } from "#/orpc/media/constants";
import type { MediaKind } from "#/orpc/media/constants";
import type { Media } from "#/orpc/media/contract";
import { ImageRejected, MediaKindNotAllowed, MediaUnusable, TooManyWaitingUploads } from "#/orpc/media/errors";
import { DiscardMedia } from "#/orpc/media/jobs.server";
import { isMediaId, isMediaKind, toPublicMedia, variantKeys } from "#/orpc/media/mapper";
import { processImage } from "#/orpc/media/processing.server";
import { MediaRepo } from "#/orpc/media/repository";
import { Jobs } from "#/server/jobs.server";
import { Storage } from "#/server/storage.server";

/*===== Quota =====*/
/**
 * How many uploads one user may have waiting to be attached. Far more than open forms ever hold, and it bounds what an
 * account can park in the bucket: unattached uploads live for `ORPHANED_MEDIA_AGE_MS` before the cleanup deletes them.
 */
export const MAX_UNATTACHED_MEDIA_PER_USER = 30;

/*===== Media Service =====*/
export class MediaService extends Context.Service<
  MediaService,
  {
    /**
     * Processes an image and stores it: every variant goes to the bucket first and the row is inserted last, so a row
     * only exists when all its variants do. Nothing attaches it yet; the entity that uses it calls `attach` when its
     * form is saved.
     */
    readonly upload: (args: {
      user: { id: string; role: UserRole };
      kind: MediaKind;
      file: File;
    }) => Effect.Effect<Media, MediaKindNotAllowed | TooManyWaitingUploads | ImageRejected>;
    /**
     * Claims an upload for the entity being saved, so the cleanup leaves it alone. Call it inside the transaction that
     * writes the entity: if that write fails, the claim is rolled back with it and the cleanup still finds the upload.
     *
     * A media belongs to one entity, so one that is already attached is refused: two entities sharing an image would
     * lose it together when either is deleted. An entity whose image didn't change doesn't attach it again.
     */
    readonly attach: (args: { mediaId: string; kind: MediaKind; userId: string }) => Effect.Effect<void, MediaUnusable>;
    /**
     * Lets go of a media its entity no longer uses: the entity was deleted, or its image replaced. Call it inside the
     * transaction that changes the entity. The media is marked unattached and its deletion is queued in that same
     * transaction, so both happen if it commits and neither if it rolls back.
     */
    readonly release: (mediaId: string) => Effect.Effect<void>;
  }
>()("app/orpc/media/MediaService") {
  static readonly layer = Layer.effect(
    MediaService,
    Effect.gen(function* () {
      const repo = yield* MediaRepo;
      const storage = yield* Storage;
      const jobs = yield* Jobs;

      /*------ Upload ------*/
      const upload = Effect.fn("MediaService.upload")(function* ({
        user,
        kind,
        file,
      }: {
        user: { id: string; role: UserRole };
        kind: MediaKind;
        file: File;
      }) {
        if (!MEDIA_UPLOAD_KINDS_BY_ROLE[user.role]?.includes(kind)) return yield* new MediaKindNotAllowed({ kind });

        // Before the image is decoded, so an account at its quota costs one count query. Two uploads racing past the
        // last free place overshoot by one, which the quota can afford.
        const waiting = yield* repo.countUnattached(user.id);
        if (waiting >= MAX_UNATTACHED_MEDIA_PER_USER) return yield* new TooManyWaitingUploads();

        // Resizing and encoding is CPU work no other span covers.
        const processed = yield* Effect.promise(() => processImage({ file, kind })).pipe(
          Effect.withSpan("media.processImage"),
        );
        if (processed.kind === "invalid") return yield* new ImageRejected({ reason: processed.reason });
        const { image } = processed;

        const mediaId = randomUUID();
        const stored = Effect.gen(function* () {
          // Every write finishes before anything is cleaned up, so no write can land after the cleanup and be left behind.
          yield* Effect.forEach(
            image.variants,
            (variant) =>
              storage.put({
                key: mediaKey({ kind, mediaId, variant: variant.name }),
                body: variant.body,
                contentType: "image/webp",
              }),
            { concurrency: "unbounded", discard: true },
          );
          return yield* repo.insert({
            id: mediaId,
            kind,
            uploadedBy: user.id,
            width: image.width,
            height: image.height,
            placeholder: image.placeholder,
          });
        });
        const record = yield* stored.pipe(
          // Deleting a key that was never written is fine, so all of them are removed. A failing cleanup must not hide
          // the original failure: it is logged, and the orphan scan can't see files without a row, so it is reported.
          Effect.onError(() =>
            storage
              .deleteMany(variantKeys({ kind, mediaId }))
              .pipe(Effect.catchCause((cause) => Effect.logError("could not clean up the variants", cause))),
          ),
        );
        return toPublicMedia(record);
      });

      /*------ Attach ------*/
      const attach = Effect.fn("MediaService.attach")(function* ({
        mediaId,
        kind,
        userId,
      }: {
        mediaId: string;
        kind: MediaKind;
        userId: string;
      }) {
        const unusable = new MediaUnusable({ mediaId });
        if (!isMediaId(mediaId)) return yield* unusable;

        const found = yield* repo.findById(mediaId);
        if (Option.isNone(found)) return yield* unusable;
        const record = found.value;
        if (!isMediaKind(record.kind) || record.kind !== kind || record.uploadedBy !== userId) return yield* unusable;
        if (record.attachedAt) return yield* unusable;

        // Past the window, the cleanup is about to delete it.
        const now = yield* Clock.currentTimeMillis;
        if (now - record.createdAt.getTime() > MEDIA_ATTACH_WINDOW_MS) return yield* unusable;

        // Checked again by the update itself: another save may have claimed it since the read.
        if (!(yield* repo.claim(mediaId))) return yield* unusable;
      });

      /*------ Release ------*/
      const release = Effect.fn("MediaService.release")(function* (mediaId: string) {
        if (!isMediaId(mediaId)) return;
        yield* repo.markDetached(mediaId);
        yield* DiscardMedia.enqueue({ mediaId }).pipe(Effect.provideService(Jobs, jobs));
      });

      return MediaService.of({ upload, attach, release });
    }),
  );
}
