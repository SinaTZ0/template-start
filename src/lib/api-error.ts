import { ORPCError } from "@orpc/client";

import { errorDataSchema } from "#/orpc/errors";
import { m } from "#/paraglide/messages";

/*===== API Failure =====*/
/** What a form shows for a failed API call: one line for the form's alert, and messages for named fields. */
export type ApiFailure = { message: string | null; fields: Record<string, string> };

/**
 * Turns whatever a mutation threw into text for the person. The API's own messages (`data.errors`, `data.fields`), in
 * the page's locale, are shown as they are; everything else gets a fixed line.
 *
 * @param fallback What to say when the API gave no message of its own, a message (`m.notes_save_failed()`).
 */
export function describeApiFailure({ error, fallback }: { error: unknown; fallback: string }): ApiFailure {
  if (!(error instanceof ORPCError)) {
    return { message: m.common_error_network(), fields: {} };
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return { message: m.common_error_signed_out(), fields: {} };
  }

  const parsed = errorDataSchema.safeParse(error.data);
  if (error.code === "INTERNAL_SERVER_ERROR") {
    const errorId = typeof error.data?.errorId === "string" ? error.data.errorId : null;
    return { message: errorId ? m.common_error_with_reference({ message: fallback, errorId }) : fallback, fields: {} };
  }

  if (parsed.success) {
    const [first] = parsed.data.errors;
    const hasFields = Object.keys(parsed.data.fields).length > 0;
    // A field-only failure is shown next to its inputs; the alert stays empty unless nothing else says what happened.
    return { message: first ?? (hasFields ? null : fallback), fields: parsed.data.fields };
  }

  return { message: fallback, fields: {} };
}
