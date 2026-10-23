import { ORPCError } from "@orpc/client";

import { errorDataSchema } from "#/orpc/errors";

/*===== API Failure =====*/
/** What a form shows for a failed API call: one line for the form's alert, and messages for named fields. */
export type ApiFailure = { message: string | null; fields: Record<string, string> };

/**
 * Turns whatever a mutation threw into text for the person. The API's own Persian messages (`data.errors`, `data.fields`)
 * are shown as they are; everything else gets a fixed line.
 *
 * @param fallback What to say when the API gave no message of its own, e.g. «ذخیره نشد. دوباره امتحان کنید.».
 */
export function describeApiFailure({ error, fallback }: { error: unknown; fallback: string }): ApiFailure {
  if (!(error instanceof ORPCError)) {
    return { message: "ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید و دوباره امتحان کنید.", fields: {} };
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return { message: "از حساب خارج شده‌اید. صفحه را تازه کنید و دوباره وارد شوید.", fields: {} };
  }

  const parsed = errorDataSchema.safeParse(error.data);
  if (error.code === "INTERNAL_SERVER_ERROR") {
    const errorId = typeof error.data?.errorId === "string" ? error.data.errorId : null;
    return { message: `${fallback}${errorId ? ` کد پیگیری: ${errorId}` : ""}`, fields: {} };
  }

  if (parsed.success) {
    const [first] = parsed.data.errors;
    const hasFields = Object.keys(parsed.data.fields).length > 0;
    // A field-only failure is shown next to its inputs; the alert stays empty unless nothing else says what happened.
    return { message: first ?? (hasFields ? null : fallback), fields: parsed.data.fields };
  }

  return { message: fallback, fields: {} };
}
