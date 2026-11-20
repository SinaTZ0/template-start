import { Data, Effect, Schema } from "effect";
import type { SchemaIssue } from "effect";

/*===== Shared Errors =====*/
// The expected failures any procedure can meet. The oRPC boundary maps each to its contract error once
// (`commonError` in `#/orpc/effect.server`), so a procedure's own error map lists only its feature's errors. Like every
// domain error they carry facts, never user-facing text.

/** No signed-in user, or the account is blocked. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}

/** The signed-in user's role may not do this. */
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {}) {}

/** The client's address used up a rate limit (`#/server/rate-limit.server`). */
export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  retryAfterSeconds: Schema.Int,
}) {}

/** A public write without a solved, unused captcha (`#/server/captcha.server`). */
export class CaptchaFailed extends Schema.TaggedError<CaptchaFailed>()("CaptchaFailed", {}) {}

/**
 * Input that breaks a domain rule (`validation.ts`), with the schema issue that says where and why. The boundary
 * turns the issue into per-field messages in the request's locale. A `Data` error, not a `Schema` one: the issue is a
 * value Schema can't describe.
 */
// @effect-diagnostics-next-line preferSchemaTaggedError:off
export class InvalidInput extends Data.TaggedError("InvalidInput")<{ readonly issue: SchemaIssue.Issue }> {}

/**
 * Decodes untrusted input with a domain schema (a feature's `validation.ts`), failing with `InvalidInput` that holds
 * every issue, so a form can show each field's message at once.
 */
export function decodeInput<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const decode = Schema.decodeUnknownEffect(schema);
  return (input: unknown): Effect.Effect<S["Type"], InvalidInput> =>
    decode(input, { errors: "all" }).pipe(Effect.mapError((error) => new InvalidInput({ issue: error.issue })));
}
