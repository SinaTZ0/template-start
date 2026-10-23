import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { getRequestSession, revokeUserSessions } from "#/lib/auth.server";
import type { UserRole } from "#/lib/user-constants";

/*===== Viewer =====*/
/** The signed-in person, as pages see them. Visitors are `null`, not a viewer. */
export type Viewer = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/**
 * Reads the session from the request's cookies. A blocked account's sessions are revoked and it reads as signed out:
 * without the revoke, the sign-in page would see the session and send them straight back to the page they can't use.
 */
const getViewer = createServerFn({ method: "GET" }).handler(async (): Promise<Viewer | null> => {
  const session = await getRequestSession(getRequestHeaders());
  if (!session) return null;

  if (session.user.status === "blocked") {
    await revokeUserSessions(session.user.id);
    return null;
  }

  // Better-Auth types additional fields as optional, but the column is NOT NULL with a default.
  const { id, name, email, role } = session.user;
  return { id, name, email, role: role ?? "user" };
});

/**
 * The viewer query. Layouts load it in `beforeLoad` and components read it with `useSuspenseQuery`. Sign-in and
 * sign-out invalidate it; other changes (an admin blocking the account) show once it goes stale.
 */
export const viewerQueryOptions = queryOptions({
  queryKey: ["viewer"],
  queryFn: () => getViewer(),
});

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
