import { z } from "zod";

/*===== Shared Error Data =====*/
// Every API error carries this shape so the UI can render any failure the same way: `errors` for
// a form-level message, `fields` for messages next to inputs. Browser-safe.
export const errorDataSchema = z.object({
  errors: z.array(z.string()),
  fields: z.record(z.string(), z.string()),
});

export type ErrorData = z.infer<typeof errorDataSchema>;

/*===== Common Errors =====*/
// Declared on every contract so these stay typed on the client. Built as plain maps (not oRPC's
// `error()` factory) to keep `@orpc/server` out of the browser bundle.
export const commonErrors = {
  INVALID_INPUT: {
    message: "Invalid input.",
    data: errorDataSchema,
  },
  INTERNAL_SERVER_ERROR: {
    message: "Internal server error.",
    // `errorId` correlates the response with the full error in the server logs.
    data: errorDataSchema.extend({ errorId: z.string() }),
  },
  // Common because every procedure is rate limited (`rateLimitMiddleware` on `base`).
  TOO_MANY_REQUESTS: {
    message: "Too many requests.",
    data: errorDataSchema.extend({ retryAfterSeconds: z.number().int().positive() }),
  },
};

/*===== HTTP Status =====*/
/** Statuses for codes oRPC doesn't already map (see `COMMON_ERROR_STATUS_MAP`). */
export const ERROR_STATUS_MAP = {
  INVALID_INPUT: 422,
};
