import { Context, Effect } from "effect";

import { getRequestSession } from "#/lib/auth.server";
import type { AuthSession } from "#/lib/auth.server";
import type { UserRole } from "#/lib/user-constants";
import { Forbidden, Unauthorized } from "#/server/errors";

/*===== Request Context =====*/
/**
 * The request an Effect runs for, provided by the boundary that runs it (`#/orpc/effect.server`). Effect code learns
 * about the request only through this: it never calls Start's `getRequest*` helpers, which read the request from
 * `AsyncLocalStorage`.
 */
export class RequestContext extends Context.Service<RequestContext, { readonly headers: Headers }>()(
  "app/server/RequestContext",
) {}

/*===== Current User =====*/
export type User = AuthSession["user"];

/**
 * The signed-in user, provided by the boundary when a procedure requires one (`access: "user"` or roles). Code that
 * needs a user requires this service, so calling it from a public procedure doesn't compile.
 */
export class CurrentUser extends Context.Service<CurrentUser, User>()("app/server/CurrentUser") {}

/*===== Access =====*/
/**
 * The signed-in user of the request.
 *
 * @throws `Unauthorized` when there is no valid session, or the account is blocked. Blocked accounts can't sign in,
 * but a session from before the block may still exist until it is revoked.
 */
export const requireUser: Effect.Effect<User, Unauthorized, RequestContext> = Effect.gen(function* () {
  const { headers } = yield* RequestContext;
  const session = yield* Effect.promise(() => getRequestSession(headers));
  if (!session || session.user.status === "blocked") return yield* new Unauthorized();
  return session.user;
}).pipe(Effect.withSpan("Auth.requireUser"));

/**
 * The signed-in user, when their role is one of `roles`. The route guards check roles too, but they are never the only
 * check.
 *
 * @throws `Unauthorized` as `requireUser` does, and `Forbidden` for any other role.
 */
export function requireRole(roles: readonly UserRole[]): Effect.Effect<User, Unauthorized | Forbidden, RequestContext> {
  return requireUser.pipe(
    // Better-Auth types additional fields as optional, but the column is NOT NULL with a default.
    Effect.filterOrFail(
      (user) => roles.includes(user.role as UserRole),
      () => new Forbidden(),
    ),
  );
}
