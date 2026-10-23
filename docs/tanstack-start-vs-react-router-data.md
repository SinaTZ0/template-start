# TanStack Start vs React Router: Data Loading and Prefetching

Why a server-rendered React app whose data layer is TanStack Query (often over an RPC layer like oRPC, tRPC or server
functions) fits TanStack Start better than React Router's Framework Mode. The difference is how each framework loads
page data, prefetches it, and keeps it fresh.

Checked on 2026-10-22 against React Router v8 Framework Mode (v7 behaves the same) and TanStack Start v1
(`@tanstack/react-start` 1.169). Re-check the linked docs if you read this much later.

## The Short Version

- **React Router:** a `loader` always runs on the server. Every navigation fetches the page's data from the server
  again, and nothing on the client keeps it between visits. `<Link prefetch>` only adds `<link>` tags: the page's code
  is preloaded and reused, but its data goes through the browser's HTTP cache. Without `Cache-Control` headers the
  browser throws the prefetched data away and the click fetches it again. With them, data can be stale after a
  mutation.
- **TanStack Start** (built on TanStack Router): loaders run on the server for the first request and in the browser
  after that. Preloading runs the target route's loader and caches the result in memory, and the click uses it. With
  TanStack Query in the loaders, prefetched data lands in the same cache the components read. Freshness is an explicit
  setting per query, and mutations invalidate exactly what they changed.

## How React Router Loads Data

| What                          | Where it runs | When                                                       |
| ----------------------------- | ------------- | ---------------------------------------------------------- |
| `loader`                      | Server only   | First visit (inside the HTML), then every navigation       |
| `clientLoader`                | Browser only  | Navigations; on the first visit only with `hydrate = true` |
| `clientLoader.hydrate = true` | Browser       | Also on hydration; the server renders `HydrateFallback`    |

Walkthrough with pages A and B:

1. Open A by URL: the server runs A's `loader` and puts the data in the HTML.
2. Click to B: the browser requests `/B.data`, and the server runs B's `loader`. A's data is dropped.
3. Go back to A: the browser requests `/A.data` and the server runs A's `loader` again. Nothing is reused.

The data is always fresh, but every navigation waits for a server round trip.

A `loader` is like a server component that returns data only: it can query the database directly, and the build keeps
it (and `*.server.ts` modules) out of the browser bundle.

## React Router's Prefetch

`<Link prefetch="intent" | "viewport" | "render">` renders `<PrefetchPageLinks>` next to the link. `<PrefetchPageLinks>`
can also be used on its own, with the same behavior. It renders no route and runs no route code; it adds tags, and the
browser downloads files:

| Part of the page | Tag                                          | Reused on click?                                                   |
| ---------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Route JS         | `<link rel="modulepreload">`                 | Yes. Kept compiled in memory for the page; no cache header needed. |
| Route CSS        | `<link rel="prefetch" as="style">`           | Yes. HTTP cache; built assets are hashed and served `immutable`.   |
| Loader data      | `<link rel="prefetch" as="fetch">` (`.data`) | Only if the response has `Cache-Control`. Otherwise fetched again. |

Measured on a production build in Chromium: clicking a prefetched link needed no new JS, but the `.data` URL was
requested twice, once by the prefetch and once by the click. Every prefetched link costs one loader run that nobody
uses. See [Fix double data request when prefetching in Remix](https://collectednotes.com/sergiodxa/fix-double-data-request-when-prefetching-in-remix).

More things that surprise people:

- **There's no code-only mode.** `prefetch` always includes the data `<link>`.
- **`clientLoader` routes are skipped for data prefetch** (`hasClientLoader` in `PrefetchPageLinksImpl`), and a `<link>`
  can't run a `clientLoader`. Prefetch never fills a client-side cache like TanStack Query's.
- **`clientLoader.hydrate` only affects the first page load** (hydration), never prefetching or later navigations.
- **Lazy route discovery can prefetch the wrong page.** With the default `routeDiscovery: { mode: "lazy" }`, links
  rendered right after a client navigation can prefetch before their route is known, match a catch-all `*` route, and
  preload the 404 page's code. `routeDiscovery: { mode: "initial" }` sends every route with the first page and fixes
  it.

### Options inside React Router

| Option                                                                                                | Trade-off                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accept it: `prefetch` for code, data fetched on click                                                 | Simple and always fresh; one wasted loader run per prefetched link.                                                                              |
| `Cache-Control` on `.data` responses                                                                  | React Router re-fetches the same `.data` URL after a mutation (revalidation). A cached response shows old data, like a cart that doesn't update. |
| Cache only prefetch requests (`Sec-Purpose: prefetch` → `private, max-age=10` in `handleDataRequest`) | Reuses the prefetch, but any request for that URL within `max-age` gets the cached copy, including one right after a mutation.                   |
| Custom code-only prefetch (preload route modules from the manifest)                                   | No wasted loader runs, but it re-implements prefetching on `UNSAFE_` router internals.                                                           |
| `clientLoader` + TanStack Query (`ensureQueryData`)                                                   | Gives a client cache, but prefetch doesn't run `clientLoader`. Needs custom wiring (`useFetcher().load()` per link), plus per-route boilerplate. |

If one of the first three is good enough for your app, React Router is fine. The rest of this doc is for apps that
want prefetched data to be used, with freshness under their control.

## How TanStack Start Loads Data

Sources: [Preloading](https://tanstack.com/router/latest/docs/framework/react/guide/preloading),
[Data Loading](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading),
[Execution Model](https://tanstack.com/start/latest/docs/framework/react/guide/execution-model),
[TanStack Query](https://tanstack.com/start/latest/docs/framework/react/guide/tanstack-query).

- **Isomorphic loaders.** "Route `loader`s are isomorphic - they run on both server and client." They run on the server
  during SSR and in the browser for navigations and preloads. Server-only work (database, secrets, session) sits behind
  an RPC: `createServerFn`, or your own RPC layer. The loader itself must be safe to run in the browser. Start's
  import protection keeps `*.server.*` files out of the client build.
- **One RPC client for both sides.** `createIsomorphicFn().server(...).client(...)` lets the loader call procedures
  in-process on the server and over HTTP in the browser, with the same code. oRPC documents this
  ([oRPC + TanStack Start](https://orpc.dev/docs/adapters/tanstack-start)).
- **Preloading runs the loader.** `defaultPreload: "intent" | "viewport" | "render"` loads the route's chunk, runs
  `beforeLoad` and `loader`, and caches the result. A click while the preload is fresh uses it; a click while it's
  still running joins it instead of starting a second request.
- **The router's own cache.** `staleTime` (default `0`), `preloadStaleTime` (default 30 s), `gcTime` /
  `preloadGcTime` (default 5 min). `router.invalidate()` marks loader data stale after a mutation.
- **TanStack Query as the cache.** Loaders call `queryClient.ensureQueryData(options)` and components read the same
  options with `useSuspenseQuery`. Set `defaultPreloadStaleTime: 0` so the router always calls the loader and Query's
  `staleTime` decides whether to fetch. `@tanstack/react-router-ssr-query` (`setupRouterSsrQueryIntegration`) moves
  the server's Query cache to the browser on the first visit, so nothing is fetched twice at hydration.

The A → B → A walkthrough in TanStack Start: A's data is in the Query cache from the first visit. Seeing or hovering the
link to A on page B preloads it if it's stale. The click renders immediately from the cache.

## A Freshness Policy That Works

A cache needs a rule for when data is refetched. Split it by who made the change:

- **Changes the visitor makes** (adds an item, edits a profile): the mutation invalidates the query keys it changed, so
  the next render refetches. `staleTime` isn't involved.
- **Changes someone else makes** (an editor publishes content, another user acts on a shared record): no mutation in
  this browser knows about them, so `staleTime` covers them. Pick a default for the `QueryClient` (5 minutes suits
  content that changes rarely) and set a shorter one (around 30 seconds) on queries where the other side's changes
  should show fast.
- **Refetch on window focus** (Query's default) refetches stale queries when the tab regains focus. It only fires for
  data that's already stale, so it mostly helps the short-`staleTime` queries. Use `refetchOnWindowFocus: "always"` for
  a query that should refresh on every focus.

React Router's only equivalents are "always refetch" (no headers) and "trust the HTTP cache" (headers), with no
per-mutation invalidation of the HTTP cache.

## What Moving Costs

- **Loaders must be browser-safe.** Anything a React Router loader does with server-only modules (session, env,
  database, storage, cookies) moves behind an RPC or server function first.
- **Page guards move.** Route middleware that redirects (sign-in, role checks) becomes `beforeLoad` +
  `throw redirect(...)`. Security stays where it should already be: in the RPC/server-function middleware.
- **Actions don't exist.** Writes are server functions or RPC mutations, followed by query invalidation or
  `router.invalidate()`. Apps already using `useMutation` for writes lose nothing.
- **Invalidation discipline.** Every mutation must invalidate the queries it affects; a missed key shows stale data
  until its `staleTime` runs out.
- **Route definitions change shape.** Code-based route configs are possible
  ([virtual file routes](https://tanstack.com/router/latest/docs/framework/react/routing/virtual-file-routes), through
  `virtualRouteConfig` in `tsr.config.json`), but each route file still uses `createFileRoute(...)`. Params
  are `$slug` (not `:slug`), optional segments `{-$slug}`, the catch-all `$`. One file can't serve two routes.
- **Search params.** TanStack Router has typed search params (`validateSearch`). nuqs's TanStack adapter doesn't cover
  Start yet ([nuqs adapters](https://nuqs.dev/docs/adapters#tanstack-router)).
- **A young framework.** Start reached v1 recently, and blog posts written against the beta and RC use renamed APIs.

## Rules for Agents in a TanStack Start + Query Codebase

- Read page data in loaders with `queryClient.ensureQueryData(options)` and in components with `useSuspenseQuery` on the
  same options. `useQuery` doesn't run during SSR, so it renders an empty page on the server.
- Never import server-only modules into a route file; put that work in a server function or RPC procedure.
- Create the `QueryClient` inside `getRouter()`, never at module scope: a module-level client on the server shares one
  user's data with the next.
- Every mutation invalidates the query keys it changes. Follow the freshness policy above for everything else.
- Use current API names: `.validator()` on server functions and middleware (`.inputValidator()` was the RC name),
  `getRouter()` exported from the router file, `getRequest` / `getRequestHeaders` from `@tanstack/react-start/server`,
  `nitro/vite` for Nitro, server routes as `server: { handlers }` on `createFileRoute`. Check the
  [RC → v1 migration notes](https://tanstack.com/start/latest/docs/framework/react/migrate-from-release-candidate).
- Use `setCookie` or `appendResponseHeader` to add a cookie; `setResponseHeader("set-cookie", ...)` replaces all of
  them.
