import { issueCaptchaChallenge } from "#/orpc/captcha/service";
import { base } from "#/orpc/implementer.server";

/*===== Create Challenge =====*/
export const createCaptchaChallengeProcedure = base.captcha.createChallenge.handler(() => issueCaptchaChallenge());
