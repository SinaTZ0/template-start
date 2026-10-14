import { ViewTransition } from "react";
import { Outlet, useLocation } from "react-router";

import { SiteFooter } from "~/components/shared/site-footer/site-footer";
import { SiteHeader, type Viewer } from "~/components/shared/site-header/site-header";
import { auth } from "~/lib/auth.server";

import type { Route } from "./+types/site-layout";

/*===== Loader =====*/
export async function loader({ request }: Route.LoaderArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  const viewer: Viewer | null = session ? { name: session.user.name, email: session.user.email } : null;
  return { viewer };
}

/*===== Site Layout =====*/

/** The chrome shared by every page: skip link, header, `main` landmark and footer. */
export default function SiteLayout({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-button text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        پرش به محتوای اصلی
      </a>
      <SiteHeader viewer={loaderData.viewer} />
      <main id="main" className="flex-1">
        {/*===== Page Transition =====*/}
        {/* Keyed by pathname, so moving to another page swaps the boundary and plays exit + enter (the fade). Query
            changes (nuqs), revalidations and hash links keep the key, and `default="none"` keeps those updates
            instant. React Router commits navigations inside `startTransition`, which is what activates it. */}
        <ViewTransition key={pathname} enter="page" exit="page" default="none">
          <Outlet />
        </ViewTransition>
      </main>
      <SiteFooter />
    </div>
  );
}
