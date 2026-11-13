import { createCaptchaChallengeProcedure } from "#/orpc/captcha/procedure";
import { implementer } from "#/orpc/implementer.server";
import { uploadMediaProcedure } from "#/orpc/media/procedure";
import {
  createNoteProcedure,
  deleteNoteProcedure,
  getNoteProcedure,
  listNotesProcedure,
  noteStatsProcedure,
  updateNoteProcedure,
} from "#/orpc/note/procedure";
import { viewerProcedure } from "#/orpc/session/procedure";
import { siteOriginProcedure } from "#/orpc/site/procedure";

/*===== API Router =====*/
// Assembled with the undecorated implementer (see `implementer.server.ts`).
export const router = implementer.router({
  captcha: {
    createChallenge: createCaptchaChallengeProcedure,
  },
  media: {
    upload: uploadMediaProcedure,
  },
  note: {
    list: listNotesProcedure,
    get: getNoteProcedure,
    create: createNoteProcedure,
    update: updateNoteProcedure,
    delete: deleteNoteProcedure,
    stats: noteStatsProcedure,
  },
  session: {
    viewer: viewerProcedure,
  },
  site: {
    origin: siteOriginProcedure,
  },
});
