import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, ViewTransition } from "react";

import { SiteFooter } from "~/components/shared/site-footer/site-footer";
import { SiteHeader } from "~/components/shared/site-header/site-header";
import { setReportedUser } from "~/lib/error-reporting.browser";
import { viewerQueryOptions } from "~/lib/viewer";

/*===== Route =====*/
export const Route = createFileRoute("/_site-layout")({
  // The header needs the viewer on every page, so it is loaded before any page renders.
  beforeLoad: ({ context }) => context.queryClient.ensureQueryData(viewerQueryOptions),
  component: SiteLayout,
});

/*===== Site Layout =====*/

/** The chrome shared by every page: skip link, header, `main` landmark and footer. */
function SiteLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data: viewer } = useSuspenseQuery(viewerQueryOptions);
  const userId = viewer?.id ?? null;

  /*------ Error Reports ------*/
  // Browser reports carry the signed-in user's ID, like the server's (docs/backend/logging.md → User ID). Sign-in and
  // sign-out invalidate the viewer query, which updates it.
  useEffect(() => setReportedUser(userId), [userId]);

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-button text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        پرش به محتوای اصلی
      </a>
      <SiteHeader viewer={viewer} />
      <main id="main" className="flex-1">
        {/*===== Page Transition =====*/}
        {/* Keyed by pathname, so moving to another page swaps the boundary and plays exit + enter (the fade). Search
            changes, refetches and hash links keep the key, and `default="none"` keeps those updates instant. */}
        <ViewTransition key={pathname} enter="page" exit="page" default="none">
          <Outlet />
        </ViewTransition>
      </main>
      <SiteFooter />
    </div>
  );
}
