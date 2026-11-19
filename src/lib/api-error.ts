import { ORPCError } from "@orpc/client";
import { Option, Schema } from "effect";

import { ErrorData } from "#/orpc/errors";
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

  if (error.code === "UNAUTHORIZED") {
    return { message: m.common_error_signed_out(), fields: {} };
  }
  // Signed in, but the role can't do this: signing in again wouldn't help, so it must not be suggested.
  if (error.code === "FORBIDDEN") {
    return { message: m.common_error_forbidden(), fields: {} };
  }

  const parsed = Schema.decodeUnknownOption(ErrorData)(error.data);
  if (error.code === "INTERNAL_SERVER_ERROR") {
    const errorId = typeof error.data?.errorId === "string" ? error.data.errorId : null;
    return { message: errorId ? m.common_error_with_reference({ message: fallback, errorId }) : fallback, fields: {} };
  }

  if (Option.isSome(parsed)) {
    const { errors, fields } = parsed.value;
    const hasFields = Object.keys(fields).length > 0;
    // A field-only failure is shown next to its inputs; the alert stays empty unless nothing else says what happened.
    return { message: errors[0] ?? (hasFields ? null : fallback), fields: { ...fields } };
  }

  return { message: fallback, fields: {} };
}
