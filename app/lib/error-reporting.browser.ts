import * as Sentry from "@sentry/browser";
import { createClientOnlyFn } from "@tanstack/react-start";

/*===== Reported User =====*/
/**
 * Tags the browser's later error reports with the signed-in user's database ID, or clears it (`null`) on sign-out.
 * Only the ID is sent, set here explicitly: `dataCollection.userInfo` stays off in `app/client.tsx`. Without a DSN the
 * SDK isn't initialized and this does nothing.
 *
 * Client-only: layouts that render on the server import it too, and Start's compiler drops the body (and the browser
 * SDK) from the server bundle. Called on the server, it does nothing.
 */
export const setReportedUser = createClientOnlyFn((userId: string | null) => {
  Sentry.setUser(userId ? { id: userId } : null);
});
