import { z } from "zod";

import { formatNumberFa } from "#/lib/digits";
import { persianText } from "#/lib/persian-text";
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "#/orpc/note/constants";

/*===== New Note =====*/
// Domain rules for a note. Messages are user-facing because they surface as field errors. Free text is normalized
// (`persianText`) before its limits are checked.
export const newNoteSchema = z.object({
  title: persianText()
    .min(1, "عنوان یادداشت را وارد کنید.")
    .max(NOTE_TITLE_MAX_LENGTH, `عنوان حداکثر ${formatNumberFa(NOTE_TITLE_MAX_LENGTH)} حرف است.`),
  body: persianText()
    .max(NOTE_BODY_MAX_LENGTH, `متن حداکثر ${formatNumberFa(NOTE_BODY_MAX_LENGTH)} حرف است.`)
    .default(""),
  // Empty text means "no image".
  imageMediaId: z
    .string()
    .optional()
    .transform((value) => value || null),
});

export type NewNote = z.output<typeof newNoteSchema>;
