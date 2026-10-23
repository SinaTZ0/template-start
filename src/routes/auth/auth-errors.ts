import { ACCOUNT_BLOCKED_CODE, CAPTCHA_FAILED_CODE } from "#/lib/auth-constants";

/*===== Types =====*/
type AuthErrorLike = { code?: string | undefined; status: number };

/*===== Mapping =====*/
/**
 * Translates a Better-Auth client error into a Persian message that says what to do next. Unknown errors become a
 * general message, so the person always sees something actionable.
 */
export function describeAuthError(error: AuthErrorLike): string {
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "ایمیل یا رمز عبور درست نیست.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "با این ایمیل قبلاً حساب ساخته شده است. وارد شوید.";
    case "PASSWORD_TOO_SHORT":
      return "رمز عبور کوتاه است.";
    case CAPTCHA_FAILED_CODE:
      return "بررسی امنیتی انجام نشد. دوباره امتحان کنید.";
    case ACCOUNT_BLOCKED_CODE:
      return "این حساب مسدود شده است.";
  }
  if (error.status === 429) return "تعداد درخواست‌ها زیاد بود. کمی صبر کنید و دوباره امتحان کنید.";
  return "درخواست انجام نشد. اتصال اینترنت را بررسی کنید و دوباره امتحان کنید.";
}
