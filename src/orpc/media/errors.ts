import { Schema } from "effect";

import { MEDIA_KINDS } from "#/orpc/media/constants";

/*===== Media Errors =====*/
// Expected failures of the media service. Facts only: the procedure that receives one writes its message.

/** The user's role doesn't use this kind of image (`MEDIA_UPLOAD_KINDS_BY_ROLE`). */
export class MediaKindNotAllowed extends Schema.TaggedError<MediaKindNotAllowed>()("MediaKindNotAllowed", {
  kind: Schema.Literals(MEDIA_KINDS),
}) {}

/** The user already has `MAX_UNATTACHED_MEDIA_PER_USER` uploads waiting to be attached. */
export class TooManyWaitingUploads extends Schema.TaggedError<TooManyWaitingUploads>()("TooManyWaitingUploads", {}) {}

/** The file isn't an image the app accepts (`ImageRejection`). */
export class ImageRejected extends Schema.TaggedError<ImageRejected>()("ImageRejected", {
  reason: Schema.Literals(["tooBig", "tooManyPixels", "unsupported", "unreadable"]),
}) {}

/**
 * The upload can't be attached: unknown, another kind, someone else's, already attached, or past the attach window.
 * One error for all of them, so a form can't probe which.
 */
export class MediaUnusable extends Schema.TaggedError<MediaUnusable>()("MediaUnusable", { mediaId: Schema.String }) {}
