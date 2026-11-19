import { Context, Effect, Layer, Option } from "effect";

import type { Viewer } from "#/orpc/session/contract";
import { Auth } from "#/server/auth.server";

/*===== Session Service =====*/
export class SessionService extends Context.Service<
  SessionService,
  {
    /**
     * The viewer of the request's session, or `null` for a visitor. A blocked account's sessions are revoked and it
     * reads as signed out: without the revoke, the sign-in page would see the session and send them straight back to
     * the page they can't use.
     */
    readonly viewer: (headers: Headers) => Effect.Effect<Viewer | null>;
  }
>()("app/orpc/session/SessionService") {
  static readonly layer = Layer.effect(
    SessionService,
    Effect.gen(function* () {
      const auth = yield* Auth;

      const viewer = Effect.fn("SessionService.viewer")(function* (headers: Headers) {
        const session = yield* auth.session(headers);
        if (Option.isNone(session)) return null;
        const { user } = session.value;
        if (user.status === "blocked") {
          yield* auth.revokeSessions(user.id);
          return null;
        }
        // Better-Auth types additional fields as optional, but the column is NOT NULL with a default.
        return { id: user.id, name: user.name, email: user.email, role: user.role ?? "user" };
      });

      return SessionService.of({ viewer });
    }),
  );
}
