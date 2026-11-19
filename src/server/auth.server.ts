import { Context, Effect, Layer, Option } from "effect";

import { getRequestSession, revokeUserSessions } from "#/lib/auth.server";
import type { AuthSession } from "#/lib/auth.server";

/*===== Auth =====*/
/**
 * Better-Auth, as the rest of the server sees it (`#/lib/auth.server` configures it; `/api/auth/*` serves it). A
 * failure here is a defect: the session store is the database.
 */
export class Auth extends Context.Service<
  Auth,
  {
    /** The session the request's cookies belong to, if any. Reading it tags the request's reports with the user. */
    readonly session: (headers: Headers) => Effect.Effect<Option.Option<AuthSession>>;
    /** Signs a user out everywhere by deleting all their sessions, e.g. once they are blocked. */
    readonly revokeSessions: (userId: string) => Effect.Effect<void>;
  }
>()("app/server/Auth") {
  static readonly layer = Layer.succeed(
    Auth,
    Auth.of({
      session: (headers) =>
        Effect.promise(() => getRequestSession(headers)).pipe(
          Effect.map(Option.fromNullishOr),
          Effect.withSpan("Auth.session"),
        ),
      revokeSessions: (userId) =>
        Effect.promise(() => revokeUserSessions(userId)).pipe(Effect.withSpan("Auth.revokeSessions")),
    }),
  );
}
