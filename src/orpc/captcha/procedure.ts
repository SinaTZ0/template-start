import { effectProcedure } from "#/orpc/effect.server";
import { base } from "#/orpc/implementer.server";
import { Captcha } from "#/server/captcha.server";

/*===== Create Challenge =====*/
// Public: anyone about to submit a public form needs one.
export const createCaptchaChallengeProcedure = effectProcedure(base.captcha.createChallenge, {
  run: () => Captcha.use((captcha) => captcha.issue),
  errors: {},
});
