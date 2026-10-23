import { QueryClient } from "@tanstack/react-query";
import { type AnyRouter, createRouter, type ParsedLocation } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { routeTree } from "./routeTree.gen";

/*===== Router Context =====*/
/** What every route's `beforeLoad` and `loader` get as `context`. */
export type RouterContext = {
  queryClient: QueryClient;
};

/*===== Page Transition =====*/
// The part of the router's location change info this file reads; the full type isn't exported.
type LocationChangeInfo = { fromLocation?: ParsedLocation; toLocation: ParsedLocation; pathChanged: boolean };

function historyIndex(location: ParsedLocation) {
  // oxlint-disable-next-line no-underscore-dangle -- the router's own name for the history position
  return location.state.__TSR_index;
}

/**
 * The view transition types for one navigation: `false` (no animation) when the pathname stays, otherwise `page`
 * plus the direction. `__TSR_index` is the router's position in the history stack, so a lower index means the visitor
 * went back. Equal indexes (a `replace` to another page) and the first navigation get the plain `page` fade.
 */
function pageTransitionTypes({ fromLocation, toLocation, pathChanged }: LocationChangeInfo) {
  if (!pathChanged) return false;
  if (!fromLocation) return ["page"];

  const fromIndex = historyIndex(fromLocation);
  const toIndex = historyIndex(toLocation);
  if (toIndex > fromIndex) return ["page", "page-forward"];
  if (toIndex < fromIndex) return ["page", "page-back"];
  return ["page"];
}

/**
 * Marks the new page for the directional slide. The browser snapshots the old page before the router commits and the
 * new one after, and `onBeforeRouteMount` fires in between, so `data-page-entering` (which gives `#main` its own
 * `view-transition-name` in `styles.css`) is only in the new snapshot. The old page then fades out as one viewport-sized
 * snapshot: a named `#main` in both would glide up or down whenever the scroll position differs between the pages.
 * The next navigation clears the mark before the browser takes its old snapshot.
 */
function markEnteringPage(router: AnyRouter) {
  const root = document.documentElement;
  router.subscribe("onBeforeNavigate", () => {
    delete root.dataset.pageEntering;
  });
  router.subscribe("onBeforeRouteMount", ({ pathChanged }) => {
    if (pathChanged) root.dataset.pageEntering = "";
  });
}

/*===== Router =====*/
/**
 * Builds the router for one request on the server, and once in the browser. The `QueryClient` is created here, never
 * at module scope: a module-level client on the server would share one user's cached data with the next request.
 */
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Changes the visitor makes invalidate their queries, so `staleTime` only covers changes made elsewhere.
        // Queries that should show other people's changes sooner set a shorter one
        // (docs/frontend/data-loading.md → Freshness).
        staleTime: 5 * 60_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient } satisfies RouterContext,
    // Hovering or focusing a link runs the target's loaders, which fill the Query cache the page then reads.
    defaultPreload: "intent",
    // The router always calls the loader on preload; Query's `staleTime` decides whether anything is fetched.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    // Moving to another pathname animates the page (docs/frontend/view-transitions.md). Search and hash changes stay
    // instant. The router starts the view transition itself: its location updates go through external stores, which
    // React can't run as a Transition, so React's `<ViewTransition>` never activates on navigation.
    defaultViewTransition: { types: pageTransitionTypes },
  });

  // Sends the server's Query cache to the browser with the page, so hydration doesn't fetch the same data again. It
  // also wraps the app in `QueryClientProvider`.
  setupRouterSsrQueryIntegration({ router, queryClient });

  if (typeof document !== "undefined") markEnteringPage(router);

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
