import type { AuthSession } from "#/lib/auth.server";
import { revokeUserSessions } from "#/lib/auth.server";
import type { Viewer } from "#/orpc/session/contract";

/*===== Viewer =====*/
/**
 * The viewer for a session's user, or `null` for a visitor. A blocked account's sessions are revoked and it reads as
 * signed out: without the revoke, the sign-in page would see the session and send them straight back to the page they
 * can't use.
 */
export async function resolveViewer({ user }: { user: AuthSession["user"] | null }): Promise<Viewer | null> {
  if (!user) return null;

  if (user.status === "blocked") {
    await revokeUserSessions(user.id);
    return null;
  }

  // Better-Auth types additional fields as optional, but the column is NOT NULL with a default.
  return { id: user.id, name: user.name, email: user.email, role: user.role ?? "user" };
}
