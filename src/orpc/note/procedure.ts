import { base } from "#/orpc/implementer.server";
import { requireUserMiddleware } from "#/orpc/middleware/auth/auth.middleware";
import { provideDbMiddleware } from "#/orpc/middleware/db/db.middleware";
import { addNote, listNotes, removeNote } from "#/orpc/note/service";

/*===== List =====*/
export const listNotesProcedure = base.note.list
  .use(requireUserMiddleware)
  .use(provideDbMiddleware)
  .handler(({ context }) => listNotes({ db: context.db, ownerId: context.user.id }));

/*===== Create =====*/
export const createNoteProcedure = base.note.create
  .use(requireUserMiddleware)
  .use(provideDbMiddleware)
  .handler(async ({ context, input, errors }) => {
    const result = await addNote({ db: context.db, ownerId: context.user.id, input });

    if (result.kind === "invalid") {
      throw errors.INVALID_INPUT({ data: { errors: [], fields: result.fields } });
    }

    return result.note;
  });

/*===== Delete =====*/
export const deleteNoteProcedure = base.note.delete
  .use(requireUserMiddleware)
  .use(provideDbMiddleware)
  .handler(async ({ context, input, errors }) => {
    const result = await removeNote({ db: context.db, ownerId: context.user.id, id: input.id });

    if (result.kind === "not-found") throw errors.NOT_FOUND({ data: { errors: [], fields: {} } });
  });
