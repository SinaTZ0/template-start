import { createAltchaChallenge } from "~/lib/altcha.server";
import type { AltchaChallenge } from "~/orpc/captcha/contract";

/*===== Challenge =====*/
/** Issues a fresh Altcha proof-of-work challenge. Public: anyone about to sign up needs one. */
export function issueCaptchaChallenge(): Promise<AltchaChallenge> {
  return createAltchaChallenge();
}
