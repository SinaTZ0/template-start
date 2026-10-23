/*===== Auth Constants =====*/
// Browser-safe values shared by the auth server (`auth.server.ts`) and the sign-up form.

/** Request header that carries the solved Altcha payload on sign-up. */
export const ALTCHA_HEADER = "x-altcha";

/** Error code returned by the sign-up hook when the Altcha payload is missing or invalid. */
export const CAPTCHA_FAILED_CODE = "CAPTCHA_FAILED";

/** Error code returned by the sign-in hook for a blocked account. */
export const ACCOUNT_BLOCKED_CODE = "ACCOUNT_BLOCKED";
