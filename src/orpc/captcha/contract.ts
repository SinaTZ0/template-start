import { oc } from "@orpc/contract";
import { z } from "zod";

import { commonErrors } from "#/orpc/errors";

/*===== Schemas =====*/
// Mirrors altcha-lib's `Challenge` field for field. The signature covers every parameter, so a key
// missing here would be stripped from the output and the widget's solution would fail verification.
const altchaChallengeSchema = z.object({
  parameters: z.object({
    algorithm: z.string(),
    nonce: z.string(),
    salt: z.string(),
    cost: z.number(),
    keyLength: z.number(),
    keyPrefix: z.string(),
    keySignature: z.string().optional(),
    memoryCost: z.number().optional(),
    parallelism: z.number().optional(),
    expiresAt: z.number().optional(),
    data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  }),
  signature: z.string().optional(),
});

export type AltchaChallenge = z.infer<typeof altchaChallengeSchema>;

/*===== Procedures =====*/
export const createCaptchaChallengeContract = oc.errors(commonErrors).output(altchaChallengeSchema);

export const captchaContract = {
  createChallenge: createCaptchaChallengeContract,
};
