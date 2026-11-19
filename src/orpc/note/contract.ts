import { oc } from "@orpc/contract";
import { Schema } from "effect";

import { standardSchema } from "#/lib/schema";
import { commonErrors, errorDataSchema } from "#/orpc/errors";
import { MediaSchema } from "#/orpc/media/contract";
import { authErrors, roleErrors } from "#/orpc/middleware/auth/auth.errors";

/*===== Schemas =====*/
export const NoteSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  image: Schema.NullOr(MediaSchema),
  createdAt: Schema.Date,
});

export type Note = typeof NoteSchema.Type;

const ListNotesInput = Schema.Struct({
  /** `nextCursor` of the page before. Left out, or one the server can't read, gives the newest notes. */
  cursor: Schema.optional(Schema.String),
});

const NotePageSchema = Schema.Struct({
  notes: Schema.Array(NoteSchema),
  /** Where the next, older page starts. Null on the last page. */
  nextCursor: Schema.NullOr(Schema.String),
});

export type NotePage = typeof NotePageSchema.Type;

const NoteIdInput = Schema.Struct({ id: Schema.String });

// Structure only. Normalizing and limits are checked by `validation.ts`.
const noteFields = {
  title: Schema.String,
  body: Schema.optional(Schema.String),
  /** From `media.upload` (kind `image`), uploaded by the same user. */
  imageMediaId: Schema.optional(Schema.String),
};

const CreateNoteInput = Schema.Struct(noteFields);

// The whole note as it should be after the call: an `imageMediaId` left out removes the image, the one the note
// already has keeps it, and another one replaces it.
const UpdateNoteInput = Schema.Struct({ id: Schema.String, ...noteFields });

const NoteStatsSchema = Schema.Struct({
  /** Every user's notes. */
  notes: Schema.Int,
  /** How many users have at least one. */
  owners: Schema.Int,
});

export type NoteStats = typeof NoteStatsSchema.Type;

/*===== Errors =====*/
const notFoundErrors = {
  NOT_FOUND: { message: "Note not found.", data: errorDataSchema },
};

/*===== Procedures =====*/
export const listNotesContract = oc
  .errors({ ...commonErrors, ...authErrors })
  .input(standardSchema(ListNotesInput))
  .output(standardSchema(NotePageSchema));

export const getNoteContract = oc
  .errors({ ...commonErrors, ...authErrors, ...notFoundErrors })
  .input(standardSchema(NoteIdInput))
  .output(standardSchema(NoteSchema));

export const createNoteContract = oc
  .errors({ ...commonErrors, ...authErrors })
  .input(standardSchema(CreateNoteInput))
  .output(standardSchema(NoteSchema));

export const updateNoteContract = oc
  .errors({ ...commonErrors, ...authErrors, ...notFoundErrors })
  .input(standardSchema(UpdateNoteInput))
  .output(standardSchema(NoteSchema));

export const deleteNoteContract = oc
  .errors({ ...commonErrors, ...authErrors, ...notFoundErrors })
  .input(standardSchema(NoteIdInput))
  .output(standardSchema(Schema.Void));

// Admins only: the example of a procedure that requires a role.
export const noteStatsContract = oc
  .errors({ ...commonErrors, ...authErrors, ...roleErrors })
  .output(standardSchema(NoteStatsSchema));

export const noteContract = {
  list: listNotesContract,
  get: getNoteContract,
  create: createNoteContract,
  update: updateNoteContract,
  delete: deleteNoteContract,
  stats: noteStatsContract,
};
