import { base } from "#/orpc/implementer.server";
import { requireRoleMiddleware, requireUserMiddleware } from "#/orpc/middleware/auth/auth.middleware";
import { provideDbMiddleware } from "#/orpc/middleware/db/db.middleware";
import { addNote, editNote, listNotes, readNote, readNoteStats, removeNote } from "#/orpc/note/service";

/*===== List =====*/
export const listNotesProcedure = base.note.list
  .use(requireUserMiddleware)
  .use(provideDbMiddleware)
  .handler(({ context, input }) => listNotes({ db: context.db, ownerId: context.user.id, cursor: input.cursor }));

/*===== Get =====*/
export const getNoteProcedure = base.note.get
  .use(requireUserMiddleware)
  .use(provideDbMiddleware)
  .handler(async ({ context, input, errors }) => {
    const note = await readNote({ db: context.db, ownerId: context.user.id, id: input.id });

    if (!note) throw errors.NOT_FOUND({ data: { errors: [], fields: {} } });

    return note;
  });

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

/*===== Update =====*/
export const updateNoteProcedure = base.note.update
  .use(requireUserMiddleware)
  .use(provideDbMiddleware)
  .handler(async ({ context, input: { id, ...fields }, errors }) => {
    const result = await editNote({ db: context.db, ownerId: context.user.id, id, input: fields });

    if (result.kind === "not-found") throw errors.NOT_FOUND({ data: { errors: [], fields: {} } });
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

/*===== Stats =====*/
// The role is the whole access rule here, so it is the middleware's: a signed-in `user` gets `FORBIDDEN`.
export const noteStatsProcedure = base.note.stats
  .use(requireRoleMiddleware("admin"))
  .use(provideDbMiddleware)
  .handler(({ context }) => readNoteStats({ db: context.db }));
