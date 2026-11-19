import { Schema } from "effect";

/*===== Note Errors =====*/
// Expected failures of the note service. Facts only: the procedure that receives one writes its message.

/** No note with this ID belongs to the user. Another user's note looks the same as a missing one. */
export class NoteNotFound extends Schema.TaggedError<NoteNotFound>()("NoteNotFound", { id: Schema.String }) {}
