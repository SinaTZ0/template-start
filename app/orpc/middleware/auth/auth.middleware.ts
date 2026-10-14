import { ORPCError, os } from "@orpc/server";

import { auth } from "~/lib/auth.server";
import type { UserRole } from "~/lib/user-constants";

/*===== Require User =====*/
/**
 * Resolves the Better-Auth session from the request cookies and exposes the signed-in user as
 * `context.user`.
 *
 * @throws `UNAUTHORIZED` (see `auth.errors.ts`) when there is no valid session, or the account is blocked. Blocked
 * accounts can't sign in, but a session from before the block may still exist until it is revoked.
 */
export const requireUserMiddleware = os.$context<{ headers: Headers }>().middleware(async ({ context, next }) => {
  const session = await auth.api.getSession({ headers: context.headers });

  if (!session || session.user.status === "blocked") {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Sign in to continue.",
      data: { errors: [], fields: {} },
    });
  }

  return next({ context: { user: session.user } });
});

/*===== Require Role =====*/
/**
 * Lets only the given roles through. Use it instead of `requireUserMiddleware`: it applies that first, so
 * `context.user` is set. The route guards check roles too, but they are never the only check.
 *
 * @throws `UNAUTHORIZED` as `requireUserMiddleware` does, and `FORBIDDEN` (see `auth.errors.ts`) for any other role.
 */
export function requireRoleMiddleware(...roles: UserRole[]) {
  return os
    .$context<{ headers: Headers }>()
    .use(requireUserMiddleware)
    .middleware(async ({ context, next }) => {
      // Better-Auth types additional fields as optional, but the column is NOT NULL with a default.
      if (!roles.includes(context.user.role as UserRole)) {
        throw new ORPCError("FORBIDDEN", {
          message: "Your account can't do this.",
          data: { errors: [], fields: {} },
        });
      }
      return next();
    });
}
