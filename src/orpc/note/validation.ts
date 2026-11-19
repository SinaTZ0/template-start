import { Schema } from "effect";

import { PersianText } from "#/lib/schema";
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "#/orpc/note/constants";
import { m } from "#/paraglide/messages";

/*===== Note Fields =====*/
// Domain rules for a note, the same for a new one and an edited one. Free text is normalized (`PersianText`) before its
// limits are checked. Each message is a function (`text`), called when the issue is formatted at the API boundary, in
// the request's locale: the service only learns that the input is invalid, never in which words.
export const NoteFields = Schema.Struct({
  title: PersianText.check(
    Schema.isMinLength(1, { text: () => m.note_error_title_required() }),
    Schema.isMaxLength(NOTE_TITLE_MAX_LENGTH, {
      text: () => m.note_error_title_too_long({ max: NOTE_TITLE_MAX_LENGTH }),
    }),
  ),
  body: Schema.optional(
    PersianText.check(
      Schema.isMaxLength(NOTE_BODY_MAX_LENGTH, {
        text: () => m.note_error_body_too_long({ max: NOTE_BODY_MAX_LENGTH }),
      }),
    ),
  ),
  /** Left out or empty: no image. */
  imageMediaId: Schema.optional(Schema.String),
});

export type NoteFields = typeof NoteFields.Type;
