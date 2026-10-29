import { errorDataSchema } from "#/orpc/errors";

/*===== Captcha Errors =====*/
// Browser-safe: declared on every contract whose procedure uses `captchaMiddleware`.
export const captchaErrors = {
  CAPTCHA_FAILED: {
    message: "The security check failed.",
    data: errorDataSchema,
  },
};
