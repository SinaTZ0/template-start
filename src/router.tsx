import { ORPCError } from "@orpc/client";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { type AnyRouter, createRouter, type ParsedLocation } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { orpc } from "#/orpc/client";
import { deLocalizeUrl, localizeUrl } from "#/paraglide/runtime";

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

function historyKey(location: ParsedLocation) {
  // oxlint-disable-next-line no-underscore-dangle -- the router's own name for the history entry
  return location.state.__TSR_key ?? location.state.key;
}

/*------ History Pops ------*/
// A swipe back on iOS is animated by the browser itself, and a view transition on top would play the change twice.
// The router's `types` callback can't see the `popstate` event, so it's noted here: the entry it landed on (its key; a
// push or a replace makes a new key, so a stale note never matches a later link) and whether the browser already
// animated it. A capture listener on `window` runs before the router's own.
let lastPop: { key: string | undefined; animatedByBrowser: boolean } | null = null;

if (typeof window !== "undefined") {
  window.addEventListener(
    "popstate",
    (event) => {
      // oxlint-disable-next-line no-underscore-dangle -- the router's own name for the history entry
      const state = event.state as { __TSR_key?: string; key?: string } | null;
      lastPop = {
        // oxlint-disable-next-line no-underscore-dangle -- as above
        key: state?.__TSR_key ?? state?.key,
        // Chrome and Safari only; elsewhere undefined, which counts as not animated.
        animatedByBrowser: event.hasUAVisualTransition === true,
      };
    },
    { capture: true },
  );
}

/**
 * The view transition types for one navigation: `false` (no animation) when the pathname stays or the browser already
 * animated a Back or Forward, otherwise `page` plus the direction. `__TSR_index` is the router's position in the
 * history stack, so a lower index means the visitor went back. Equal indexes (a `replace` to another page) and the
 * first navigation get the plain `page` fade.
 */
function pageTransitionTypes({ fromLocation, toLocation, pathChanged }: LocationChangeInfo) {
  const pop = lastPop;
  lastPop = null;
  if (!pathChanged) return false;
  if (pop?.animatedByBrowser && pop.key !== undefined && pop.key === historyKey(toLocation)) return false;
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
    queryCache: new QueryCache({ onError: (error) => leaveOnRefusal(error) }),
    mutationCache: new MutationCache({ onError: (error) => leaveOnRefusal(error) }),
  });

  /*------ Signed Out Elsewhere ------*/
  // Guards read the viewer through the Query cache, so a tab that is already open doesn't notice at once when the
  // session ends elsewhere (signed out in another tab, expired, or blocked). The first API call that answers
  // `UNAUTHORIZED` asks for the viewer again; if the session is really gone, the current page's guards run again and
  // send the person to sign in, with the page as `redirectTo`. Browser only: on the server the guard has just read
  // the session itself.
  let leaving: Promise<void> | null = null;
  function leaveOnRefusal(error: unknown) {
    if (typeof window === "undefined" || leaving) return;
    if (!(error instanceof ORPCError) || error.code !== "UNAUTHORIZED") return;

    leaving = queryClient
      .fetchQuery(orpc.session.viewer.queryOptions({ staleTime: 0 }))
      // Still signed in (a refusal for another reason): leave the page as it is, or its loaders would ask again.
      .then((viewer) => (viewer ? undefined : router.invalidate()))
      .catch(() => undefined)
      .finally(() => {
        leaving = null;
      });
  }

  const router = createRouter({
    routeTree,
    context: { queryClient } satisfies RouterContext,
    // Routes are declared without a locale (`/notes`). Incoming URLs lose their prefix (`/en/notes` → `/notes`), and
    // every link, redirect and preload gets the current locale's back, so the visitor stays in their language
    // (docs/frontend/i18n.md).
    rewrite: {
      input: ({ url }) => deLocalizeUrl(url),
      output: ({ url }) => localizeUrl(url),
    },
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
