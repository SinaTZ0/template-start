import { Schema } from "effect";

import { optionalSearchParam, searchSchema } from "#/lib/schema";

/*===== Notes Search =====*/
// `?before=<cursor>` shows the page of notes older than the one before it (`nextCursor` from `note.list`). Optional
// rather than defaulted: absent means the newest notes. The API reads the cursor again and starts over for one it
// can't use, so a hand-edited link still shows a page.
export const notesSearchSchema = searchSchema(
  Schema.Struct({
    before: optionalSearchParam(Schema.String.check(Schema.isMaxLength(100))),
  }),
);
