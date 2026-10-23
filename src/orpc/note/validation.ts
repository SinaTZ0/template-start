import { z } from "zod";

import { persianText } from "#/lib/persian-text";
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "#/orpc/note/constants";
import { m } from "#/paraglide/messages";

/*===== New Note =====*/
// Domain rules for a note. Messages are user-facing because they surface as field errors, so each is a function zod
// calls when the check fails, in the request's locale. Free text is normalized (`persianText`) before its limits are
// checked.
export const newNoteSchema = z.object({
  title: persianText()
    .min(1, { error: () => m.note_error_title_required() })
    .max(NOTE_TITLE_MAX_LENGTH, { error: () => m.note_error_title_too_long({ max: NOTE_TITLE_MAX_LENGTH }) }),
  body: persianText()
    .max(NOTE_BODY_MAX_LENGTH, { error: () => m.note_error_body_too_long({ max: NOTE_BODY_MAX_LENGTH }) })
    .default(""),
  // Empty text means "no image".
  imageMediaId: z
    .string()
    .optional()
    .transform((value) => value || null),
});

export type NewNote = z.output<typeof newNoteSchema>;
