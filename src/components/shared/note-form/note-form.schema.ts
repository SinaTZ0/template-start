import { Schema } from "effect";

import { PersianText, standardSchema } from "#/lib/schema";
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "#/orpc/note/constants";
import { m } from "#/paraglide/messages";

/*===== Note Form =====*/
// Written for the form's messages; the server's `validation.ts` is the final authority.
const NoteFormFields = Schema.Struct({
  title: PersianText.check(
    Schema.isMinLength(1, { text: () => m.notes_form_title_required() }),
    Schema.isMaxLength(NOTE_TITLE_MAX_LENGTH, { text: () => m.notes_form_title_too_long() }),
  ),
  body: PersianText.check(Schema.isMaxLength(NOTE_BODY_MAX_LENGTH, { text: () => m.notes_form_body_too_long() })),
});

/** The form's schema, for `standardSchemaResolver`. */
export const noteFormSchema = standardSchema(NoteFormFields);

export type NoteFormValues = typeof NoteFormFields.Type;
