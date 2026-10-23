import { base } from "#/orpc/implementer.server";
import { requireUserMiddleware } from "#/orpc/middleware/auth/auth.middleware";
import { provideDbMiddleware } from "#/orpc/middleware/db/db.middleware";
import { rateLimitMiddleware } from "#/orpc/middleware/rate-limit/rate-limit.middleware";
import { uploadMedia } from "#/orpc/media/service";
import type { UserRole } from "#/lib/user-constants";

/*===== Upload =====*/
// Each upload decodes and re-encodes an image of up to 10 MB with sharp, so it gets a far lower limit than the API's.
const UPLOAD_RATE_LIMIT = { name: "media-upload", limit: 20, windowMs: 60_000 };

// Any signed-in user; which kinds a role may upload is the service's rule.
export const uploadMediaProcedure = base.media.upload
  .use(rateLimitMiddleware(UPLOAD_RATE_LIMIT))
  .use(requireUserMiddleware)
  .use(provideDbMiddleware)
  .handler(async ({ context, input, errors }) => {
    const result = await uploadMedia({
      db: context.db,
      // Better-Auth types additional fields as optional, but the column is NOT NULL with a default.
      user: { id: context.user.id, role: context.user.role as UserRole },
      kind: input.kind,
      file: input.file,
    });

    if (result.kind === "forbidden") throw errors.FORBIDDEN({ data: { errors: [], fields: {} } });
    if (result.kind === "invalid") throw errors.INVALID_INPUT({ data: { errors: [], fields: result.fields } });

    return result.media;
  });
