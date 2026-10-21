import { z } from "zod";

import { persianText } from "~/lib/persian-text";
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "~/orpc/note/constants";

/*===== New Note Form =====*/
// Written for the form's messages; the server's `validation.ts` is the final authority.
export const noteFormSchema = z.object({
  title: persianText().min(1, "عنوان را وارد کنید.").max(NOTE_TITLE_MAX_LENGTH, "عنوان طولانی است."),
  body: persianText().max(NOTE_BODY_MAX_LENGTH, "متن طولانی است."),
});

export type NoteFormValues = z.infer<typeof noteFormSchema>;
