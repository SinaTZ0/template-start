import { oc } from "@orpc/contract";
import { Schema } from "effect";

import { standardSchema } from "#/lib/schema";
import { commonErrors } from "#/orpc/errors";

/*===== Schemas =====*/
// Mirrors altcha-lib's `Challenge` field for field. The signature covers every parameter, so the output is checked
// strictly: a key altcha-lib adds and this doesn't name fails the call loudly, instead of reaching the browser
// without it and failing every solution's verification.
const AltchaChallengeSchema = Schema.Struct({
  parameters: Schema.Struct({
    algorithm: Schema.String,
    nonce: Schema.String,
    salt: Schema.String,
    cost: Schema.Finite,
    keyLength: Schema.Finite,
    keyPrefix: Schema.String,
    keySignature: Schema.optional(Schema.String),
    memoryCost: Schema.optional(Schema.Finite),
    parallelism: Schema.optional(Schema.Finite),
    expiresAt: Schema.optional(Schema.Finite),
    data: Schema.optional(
      Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Null])),
    ),
  }),
  signature: Schema.optional(Schema.String),
});

export type AltchaChallenge = typeof AltchaChallengeSchema.Type;

/*===== Procedures =====*/
export const createCaptchaChallengeContract = oc.errors(commonErrors).output(standardSchema(AltchaChallengeSchema));

export const captchaContract = {
  createChallenge: createCaptchaChallengeContract,
};
