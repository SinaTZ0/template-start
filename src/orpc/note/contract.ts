import { oc } from "@orpc/contract";
import { z } from "zod";

import { commonErrors, errorDataSchema } from "#/orpc/errors";
import { mediaSchema } from "#/orpc/media/contract";
import { authErrors, roleErrors } from "#/orpc/middleware/auth/auth.errors";

/*===== Schemas =====*/
export const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  image: mediaSchema.nullable(),
  createdAt: z.date(),
});

export type Note = z.infer<typeof noteSchema>;

const listNotesInputSchema = z.strictObject({
  /** `nextCursor` of the page before. Left out, or one the server can't read, gives the newest notes. */
  cursor: z.string().optional(),
});

const notePageSchema = z.object({
  notes: z.array(noteSchema),
  /** Where the next, older page starts. Null on the last page. */
  nextCursor: z.string().nullable(),
});

export type NotePage = z.infer<typeof notePageSchema>;

const noteIdInputSchema = z.strictObject({ id: z.string() });

// Structure only. Trimming and limits are checked by `validation.ts`.
const noteFieldsShape = {
  title: z.string(),
  body: z.string().optional(),
  /** From `media.upload` (kind `image`), uploaded by the same user. */
  imageMediaId: z.string().optional(),
};

const createNoteInputSchema = z.strictObject(noteFieldsShape);

// The whole note as it should be after the call: an `imageMediaId` left out removes the image, the one the note
// already has keeps it, and another one replaces it.
const updateNoteInputSchema = z.strictObject({ id: z.string(), ...noteFieldsShape });

const noteStatsSchema = z.object({
  /** Every user's notes. */
  notes: z.number().int(),
  /** How many users have at least one. */
  owners: z.number().int(),
});

export type NoteStats = z.infer<typeof noteStatsSchema>;

/*===== Errors =====*/
const notFoundErrors = {
  NOT_FOUND: { message: "Note not found.", data: errorDataSchema },
};

/*===== Procedures =====*/
export const listNotesContract = oc
  .errors({ ...commonErrors, ...authErrors })
  .input(listNotesInputSchema)
  .output(notePageSchema);

export const getNoteContract = oc
  .errors({ ...commonErrors, ...authErrors, ...notFoundErrors })
  .input(noteIdInputSchema)
  .output(noteSchema);

export const createNoteContract = oc
  .errors({ ...commonErrors, ...authErrors })
  .input(createNoteInputSchema)
  .output(noteSchema);

export const updateNoteContract = oc
  .errors({ ...commonErrors, ...authErrors, ...notFoundErrors })
  .input(updateNoteInputSchema)
  .output(noteSchema);

export const deleteNoteContract = oc
  .errors({ ...commonErrors, ...authErrors, ...notFoundErrors })
  .input(noteIdInputSchema)
  .output(z.void());

// Admins only: the example of a procedure behind `requireRoleMiddleware`.
export const noteStatsContract = oc.errors({ ...commonErrors, ...authErrors, ...roleErrors }).output(noteStatsSchema);

export const noteContract = {
  list: listNotesContract,
  get: getNoteContract,
  create: createNoteContract,
  update: updateNoteContract,
  delete: deleteNoteContract,
  stats: noteStatsContract,
};
