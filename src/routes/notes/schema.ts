import { z } from "zod";

import { persianText } from "#/lib/persian-text";
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "#/orpc/note/constants";
import { m } from "#/paraglide/messages";

/*===== New Note Form =====*/
// Written for the form's messages; the server's `validation.ts` is the final authority.
export const noteFormSchema = z.object({
  title: persianText()
    .min(1, { error: () => m.notes_form_title_required() })
    .max(NOTE_TITLE_MAX_LENGTH, { error: () => m.notes_form_title_too_long() }),
  body: persianText().max(NOTE_BODY_MAX_LENGTH, { error: () => m.notes_form_body_too_long() }),
});

export type NoteFormValues = z.infer<typeof noteFormSchema>;
