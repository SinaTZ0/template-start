import { z } from "zod";

import { formatNumberFa } from "~/lib/digits";
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "~/orpc/note/constants";

/*===== New Note =====*/
// Domain rules for a note. Messages are user-facing because they surface as field errors.
export const newNoteSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "عنوان یادداشت را وارد کنید.")
    .max(NOTE_TITLE_MAX_LENGTH, `عنوان حداکثر ${formatNumberFa(NOTE_TITLE_MAX_LENGTH)} حرف است.`),
  body: z
    .string()
    .trim()
    .max(NOTE_BODY_MAX_LENGTH, `متن حداکثر ${formatNumberFa(NOTE_BODY_MAX_LENGTH)} حرف است.`)
    .default(""),
  // Empty text means "no image".
  imageMediaId: z
    .string()
    .optional()
    .transform((value) => value || null),
});

export type NewNote = z.output<typeof newNoteSchema>;
