import { ORPCError, os } from "@orpc/server";

import { verifyAltchaPayload } from "#/lib/altcha.server";
import { m } from "#/paraglide/messages";

/*===== Captcha =====*/
/**
 * Lets a call through only with a solved Altcha challenge in `input.captcha` (from `captcha.createChallenge`, solved
 * in the browser by `useCaptcha`). For public procedures that write: it keeps scripts from filling the tables. Apply
 * it after the procedure's rate limit, so a flood is turned away before any verification work.
 *
 * Each payload works once (`verifyAltchaPayload` remembers it), so a retry needs a fresh solve.
 *
 * @throws `CAPTCHA_FAILED` (see `captcha.errors.ts`) for a missing, invalid, expired or reused payload.
 */
export const captchaMiddleware = os.middleware(async ({ next }, input: { captcha: string }) => {
  if (!(await verifyAltchaPayload(input.captcha))) {
    throw new ORPCError("CAPTCHA_FAILED", {
      message: "The security check failed.",
      data: { errors: [m.common_captcha_failed()], fields: {} },
    });
  }
  return next();
});
