import { Effect } from "effect";

import { createAltchaChallenge, verifyAltchaPayload } from "#/lib/altcha.server";
import type { AltchaChallenge } from "#/orpc/captcha/contract";
import { CaptchaFailed } from "#/server/errors";

/*===== Captcha =====*/
// Altcha proof of work (`#/lib/altcha.server`): the only thing between a public form and a script that fills its table.

/** A fresh challenge for the browser to solve. Public: anyone about to submit a public form needs one. */
export const issueCaptchaChallenge: Effect.Effect<AltchaChallenge> = Effect.promise(() => createAltchaChallenge()).pipe(
  Effect.withSpan("Captcha.issue"),
);

/**
 * Lets a call through only with a solved challenge. Each payload works once (`verifyAltchaPayload` remembers it), so a
 * retry needs a fresh solve.
 *
 * @throws `CaptchaFailed` for a missing, invalid, expired or reused payload.
 */
export const verifyCaptcha = (payload: string): Effect.Effect<void, CaptchaFailed> =>
  Effect.promise(() => verifyAltchaPayload(payload)).pipe(
    Effect.flatMap((solved) => (solved ? Effect.void : Effect.fail(new CaptchaFailed()))),
    Effect.withSpan("Captcha.verify"),
  );
