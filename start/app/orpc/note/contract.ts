import { oc } from "@orpc/contract";
import { z } from "zod";

import { commonErrors, errorDataSchema } from "~/orpc/errors";
import { mediaSchema } from "~/orpc/media/contract";
import { authErrors } from "~/orpc/middleware/auth/auth.errors";

/*===== Schemas =====*/
export const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  image: mediaSchema.nullable(),
  createdAt: z.date(),
});

export type Note = z.infer<typeof noteSchema>;

// Structure only. Trimming and limits are checked by `validation.ts`.
const createNoteInputSchema = z.strictObject({
  title: z.string(),
  body: z.string().optional(),
  /** From `media.upload` (kind `image`), uploaded by the same user. */
  imageMediaId: z.string().optional(),
});

const deleteNoteInputSchema = z.strictObject({ id: z.string() });

/*===== Errors =====*/
const notFoundErrors = {
  NOT_FOUND: { message: "Note not found.", data: errorDataSchema },
};

/*===== Procedures =====*/
export const listNotesContract = oc.errors({ ...commonErrors, ...authErrors }).output(z.array(noteSchema));

export const createNoteContract = oc
  .errors({ ...commonErrors, ...authErrors })
  .input(createNoteInputSchema)
  .output(noteSchema);

export const deleteNoteContract = oc
  .errors({ ...commonErrors, ...authErrors, ...notFoundErrors })
  .input(deleteNoteInputSchema)
  .output(z.void());

export const noteContract = {
  list: listNotesContract,
  create: createNoteContract,
  delete: deleteNoteContract,
};
