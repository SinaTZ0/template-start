import { Outlet } from "react-router";

import { requireSession } from "~/lib/session-guard.server";

import type { Route } from "./+types/notes-layout";

/*===== Guard =====*/
// Every route below this layout needs a signed-in user. Loaders read the session with `context.get(sessionContext)`.
export const middleware: Route.MiddlewareFunction[] = [requireSession({ roles: ["user", "admin"] })];

export default function NotesLayout() {
  return <Outlet />;
}
