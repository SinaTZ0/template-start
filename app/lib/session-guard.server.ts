import { createContext, redirect, type MiddlewareFunction } from "react-router";

import { type AuthSession, getRequestSession, revokeUserSessions } from "~/lib/auth.server";
import type { UserRole } from "~/lib/user-constants";

/*===== Session Context =====*/
/**
 * The signed-in session, set by `requireSession` on a guarded layout. Every loader and action below that layout reads
 * it with `context.get(sessionContext)` instead of fetching the session again.
 */
export const sessionContext = createContext<AuthSession>();

/*===== Role Homes =====*/
// Where a signed-in person belongs when they open a page their role can't use, and where sign-in sends them by default.
const ROLE_HOME: Record<UserRole, string> = {
  user: "/notes",
  admin: "/notes",
};

/** The landing page for a role. Unknown roles (a value removed from the list) go to the home page. */
export function roleHomePath(role: string | null | undefined): string {
  return ROLE_HOME[role as UserRole] ?? "/";
}

/*===== Guard =====*/
/**
 * Route middleware for a guarded layout. Loads the session once and puts it in the router context for every child
 * loader and action.
 *
 * - Signed out: redirect to `/auth?redirectTo=<this page>`, which sends them back after signing in.
 * - Blocked: the account's sessions are revoked and they are sent to sign in, which refuses blocked accounts.
 *   Without the revoke, the sign-in page would see the session and send them straight back here.
 * - A role outside `roles`: redirect to that role's own home.
 *
 * The UI guard is never the only check: oRPC procedures check the role again (`requireRoleMiddleware`).
 */
export function requireSession({ roles }: { roles: readonly UserRole[] }): MiddlewareFunction<Response> {
  return async ({ request, context }) => {
    const session = await getRequestSession(request.headers);
    const signIn = signInRedirect(request);

    if (!session) throw signIn;

    if (session.user.status === "blocked") {
      await revokeUserSessions(session.user.id);
      throw signIn;
    }

    // Better-Auth types additional fields as optional, but the column is NOT NULL with a default.
    if (!roles.includes(session.user.role as UserRole)) throw redirect(roleHomePath(session.user.role));

    context.set(sessionContext, session);
  };
}

/** Sends the visitor to sign in and back to the page they asked for, query string included. */
function signInRedirect(request: Request) {
  const url = new URL(request.url);
  // Client navigations fetch `<path>.data` (`/_.data` for the root); the page itself is what they asked for. Mirrors
  // React Router's `getNormalizedPath`, which isn't exported.
  const pathname = url.pathname.endsWith("/_.data")
    ? url.pathname.slice(0, -"_.data".length)
    : url.pathname.replace(/\.data$/, "");
  url.searchParams.delete("_routes");
  const search = url.searchParams.size ? `?${url.searchParams}` : "";
  return redirect(`/auth?redirectTo=${encodeURIComponent(pathname + search)}`);
}
