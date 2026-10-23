/*===== Auth Constants =====*/
// Browser-safe values shared by the auth server (`auth.server.ts`) and the sign-up form.

/** The longest display name, after normalization. The form and the server both check it. */
export const NAME_MAX_LENGTH = 60;

/** Request header that carries the solved Altcha payload on sign-up. */
export const ALTCHA_HEADER = "x-altcha";

/** Error code returned by the sign-up hook when the Altcha payload is missing or invalid. */
export const CAPTCHA_FAILED_CODE = "CAPTCHA_FAILED";

/** Error code returned by the sign-in hook for a blocked account. */
export const ACCOUNT_BLOCKED_CODE = "ACCOUNT_BLOCKED";

/** Error codes returned by the sign-up and update-user hook for a display name that is empty or too long. */
export const NAME_REQUIRED_CODE = "NAME_REQUIRED";
export const NAME_TOO_LONG_CODE = "NAME_TOO_LONG";
