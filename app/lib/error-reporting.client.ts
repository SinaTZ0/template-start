import * as Sentry from "@sentry/browser";

/*===== Reported User =====*/
/**
 * Tags the browser's later error reports with the signed-in user's database ID, or clears it (`null`) on sign-out.
 * Only the ID is sent, set here explicitly: `dataCollection.userInfo` stays off in `entry.client.tsx`. Without a DSN
 * the SDK isn't initialized and this does nothing.
 */
export function setReportedUser(userId: string | null) {
  Sentry.setUser(userId ? { id: userId } : null);
}
