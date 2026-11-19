import { Schema } from "effect";

import { standardSchema } from "#/lib/schema";

/*===== Shared Error Data =====*/
/**
 * Every API error carries this shape so the UI can render any failure the same way: `errors` for a form-level message,
 * `fields` for messages next to inputs. Browser-safe.
 */
export const ErrorData = Schema.Struct({
  errors: Schema.Array(Schema.String),
  fields: Schema.Record(Schema.String, Schema.String),
});

export type ErrorData = typeof ErrorData.Type;

/** `ErrorData` for a contract's `.errors({ … })`. */
export const errorDataSchema = standardSchema(ErrorData);

/** Error data that says nothing more than its code: `errors.NOT_FOUND({ data: noErrorData })`. */
export const noErrorData: ErrorData = { errors: [], fields: {} };

/*===== Common Errors =====*/
// Declared on every contract so these stay typed on the client. Plain maps (not oRPC's `error()` factory) to keep
// `@orpc/server` out of the browser bundle.
export const commonErrors = {
  INVALID_INPUT: {
    message: "Invalid input.",
    data: errorDataSchema,
  },
  INTERNAL_SERVER_ERROR: {
    message: "Internal server error.",
    // `errorId` correlates the response with the full error in the server logs and the error viewer.
    data: standardSchema(Schema.Struct({ ...ErrorData.fields, errorId: Schema.String })),
  },
  // Common because every procedure is rate limited (`rateLimitMiddleware` on `base`).
  TOO_MANY_REQUESTS: {
    message: "Too many requests.",
    data: standardSchema(
      Schema.Struct({ ...ErrorData.fields, retryAfterSeconds: Schema.Int.check(Schema.isGreaterThan(0)) }),
    ),
  },
};

/*===== HTTP Status =====*/
/** Statuses for codes oRPC doesn't already map (see `COMMON_ERROR_STATUS_MAP`). */
export const ERROR_STATUS_MAP = {
  INVALID_INPUT: 422,
  CAPTCHA_FAILED: 400,
};
