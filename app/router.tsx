import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { routeTree } from "./routeTree.gen";

/*===== Router Context =====*/
/** What every route's `beforeLoad` and `loader` get as `context`. */
export type RouterContext = {
  queryClient: QueryClient;
};

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
    // Moving to another pathname fades the page (docs/frontend/view-transitions.md). Search and hash changes stay
    // instant. The router starts the view transition itself: its location updates go through external stores, which
    // React can't run as a Transition, so React's `<ViewTransition>` never activates on navigation.
    defaultViewTransition: { types: ({ pathChanged }) => (pathChanged ? ["page"] : false) },
  });

  // Sends the server's Query cache to the browser with the page, so hydration doesn't fetch the same data again. It
  // also wraps the app in `QueryClientProvider`.
  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
