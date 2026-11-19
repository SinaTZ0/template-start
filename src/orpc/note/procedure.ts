import { Effect } from "effect";

import { effectProcedure } from "#/orpc/effect.server";
import { noErrorData } from "#/orpc/errors";
import { base } from "#/orpc/implementer.server";
import { NoteService } from "#/orpc/note/service";
import { m } from "#/paraglide/messages";
import { CurrentUser } from "#/server/request-context.server";

/*===== Messages =====*/
/** The picked image can't be used: shown under the image field. Called by the error map, in the request's locale. */
const imageUnusable = () => ({ errors: [], fields: { imageMediaId: m.note_error_image_unusable() } });

/*===== List =====*/
export const listNotesProcedure = effectProcedure(base.note.list, {
  access: "user",
  run: ({ input }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      return yield* (yield* NoteService).list({ ownerId: user.id, cursor: input.cursor });
    }),
  errors: {},
});

/*===== Get =====*/
export const getNoteProcedure = effectProcedure(base.note.get, {
  access: "user",
  run: ({ input }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      return yield* (yield* NoteService).read({ ownerId: user.id, id: input.id });
    }),
  errors: {
    NoteNotFound: ({ errors }) => errors.NOT_FOUND({ data: noErrorData }),
  },
});

/*===== Create =====*/
export const createNoteProcedure = effectProcedure(base.note.create, {
  access: "user",
  run: ({ input }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      return yield* (yield* NoteService).add({ ownerId: user.id, input });
    }),
  errors: {
    MediaUnusable: ({ errors }) => errors.INVALID_INPUT({ data: imageUnusable() }),
  },
});

/*===== Update =====*/
export const updateNoteProcedure = effectProcedure(base.note.update, {
  access: "user",
  run: ({ input: { id, ...fields } }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      return yield* (yield* NoteService).edit({ ownerId: user.id, id, input: fields });
    }),
  errors: {
    NoteNotFound: ({ errors }) => errors.NOT_FOUND({ data: noErrorData }),
    MediaUnusable: ({ errors }) => errors.INVALID_INPUT({ data: imageUnusable() }),
  },
});

/*===== Delete =====*/
export const deleteNoteProcedure = effectProcedure(base.note.delete, {
  access: "user",
  run: ({ input }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      yield* (yield* NoteService).remove({ ownerId: user.id, id: input.id });
    }),
  errors: {
    NoteNotFound: ({ errors }) => errors.NOT_FOUND({ data: noErrorData }),
  },
});

/*===== Stats =====*/
// The role is the whole access rule here: a signed-in `user` gets `FORBIDDEN`.
export const noteStatsProcedure = effectProcedure(base.note.stats, {
  access: ["admin"],
  run: () => NoteService.use((notes) => notes.stats),
  errors: {},
});
