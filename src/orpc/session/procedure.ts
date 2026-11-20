import { Effect } from "effect";

import { effectProcedure } from "#/orpc/effect.server";
import { base } from "#/orpc/implementer.server";
import { SessionService } from "#/orpc/session/service";
import { RequestContext } from "#/server/request-context.server";

/*===== Viewer =====*/
// Public: a visitor reads as `null`.
export const viewerProcedure = effectProcedure(base.session.viewer, {
  run: () =>
    Effect.gen(function* () {
      const { headers } = yield* RequestContext;
      const sessions = yield* SessionService;
      return yield* sessions.viewer(headers);
    }),
  errors: {},
});
