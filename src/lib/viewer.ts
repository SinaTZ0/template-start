import type { UserRole } from "#/lib/user-constants";

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
