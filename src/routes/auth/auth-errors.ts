import { ACCOUNT_BLOCKED_CODE, CAPTCHA_FAILED_CODE } from "#/lib/auth-constants";
import { m } from "#/paraglide/messages";

/*===== Types =====*/
type AuthErrorLike = { code?: string | undefined; status: number };

/*===== Mapping =====*/
/**
 * Translates a Better-Auth client error into a message, in the page's locale, that says what to do next. Better-Auth
 * answers with codes, not text the page could show. Unknown errors become a general message, so the person always sees
 * something actionable.
 */
export function describeAuthError(error: AuthErrorLike): string {
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return m.auth_error_invalid_credentials();
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return m.auth_error_user_exists();
    case "PASSWORD_TOO_SHORT":
      return m.auth_error_password_too_short();
    case CAPTCHA_FAILED_CODE:
      return m.auth_error_captcha_failed();
    case ACCOUNT_BLOCKED_CODE:
      return m.auth_error_account_blocked();
  }
  if (error.status === 429) return m.common_rate_limited();
  return m.auth_error_unknown();
}
