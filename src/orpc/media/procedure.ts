import { Effect } from "effect";

import type { UserRole } from "#/lib/user-constants";
import { effectProcedure } from "#/orpc/effect.server";
import { noErrorData } from "#/orpc/errors";
import { base } from "#/orpc/implementer.server";
import { IMAGE_REJECTION_TEXT } from "#/orpc/media/processing.server";
import { MediaService } from "#/orpc/media/service";
import { m } from "#/paraglide/messages";
import { CurrentUser } from "#/server/request-context.server";

/*===== Upload =====*/
// Each upload decodes and re-encodes an image of up to 10 MB with sharp, so it gets a far lower limit than the API's.
const UPLOAD_RATE_LIMIT = { name: "media-upload", limit: 20, windowMs: 60_000 };

/** A message under the file field, in the request's locale. */
const fileError = (message: string) => ({ errors: [], fields: { file: message } });

// Any signed-in user; which kinds a role may upload is the service's rule.
export const uploadMediaProcedure = effectProcedure(base.media.upload, {
  access: "user",
  rateLimit: UPLOAD_RATE_LIMIT,
  run: ({ input }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      return yield* (yield* MediaService).upload({
        // Better-Auth types additional fields as optional, but the column is NOT NULL with a default.
        user: { id: user.id, role: user.role as UserRole },
        kind: input.kind,
        file: input.file,
      });
    }),
  errors: {
    MediaKindNotAllowed: ({ errors }) => errors.FORBIDDEN({ data: noErrorData }),
    TooManyWaitingUploads: ({ errors }) => errors.INVALID_INPUT({ data: fileError(m.media_error_too_many_waiting()) }),
    ImageRejected: ({ error, errors }) =>
      errors.INVALID_INPUT({ data: fileError(IMAGE_REJECTION_TEXT[error.reason]()) }),
  },
});
