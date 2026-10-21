# Data Loading

How pages get their data, keep it fresh, and refresh it after a change. TanStack Query is the one cache; the router
fills it before a page renders, and components read from it. Why this design, and how it differs from React Router's
loaders: [tanstack-start-vs-react-router-data.md](../tanstack-start-vs-react-router-data.md).

## The Pieces

| Piece                  | Where                                       | Job                                                                   |
| ---------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| `QueryClient`          | `getRouter()` in `app/router.tsx`           | The cache. One per server request, one in the browser.                |
| Router context         | `context.queryClient` in every route        | Gives `beforeLoad` and `loader` the cache.                            |
| `orpc` utilities       | `app/orpc/client.ts`                        | `queryOptions` / `mutationOptions` / keys for every procedure.        |
| Isomorphic oRPC client | `app/orpc/client.ts`                        | In-process on the server, `RPCLink` → `/rpc` in the browser.          |
| SSR Query integration  | `setupRouterSsrQueryIntegration`            | Sends the server's cache with the page, so hydration fetches nothing. |
| Viewer query           | `viewerQueryOptions` in `app/lib/viewer.ts` | The signed-in person, for the header and the guards.                  |

## Where Code Runs

Route `beforeLoad` and `loader` functions are **isomorphic**: they run on the server for the first request, and in
the browser for navigations and preloads. So a route file never imports server-only modules (`*.server.ts`, the
database, `env`). Server-only work sits behind one of two doors:

- **oRPC procedures**, for everything that is the app's API: reads and writes of feature data. This is the default.
  Loaders call them through `orpc.<feature>.<procedure>.queryOptions()`, which runs the procedure in-process during
  SSR and over `/rpc` in the browser, with the same code.
- **Server functions** (`createServerFn`), only for small framework-level reads that aren't part of the API: the
  viewer (`app/lib/viewer.ts`) and the site origin (`app/root.tsx`). Don't add feature data here; add a procedure
  ([backend-flow.md](../backend-flow.md)).

Start's import protection fails the build when browser-reachable code imports a `*.server.ts` file outside a server
function's handler. A module that must only run in the browser uses `createClientOnlyFn` (see
`app/lib/error-reporting.browser.ts`), not a `.client.ts` name.

## Reading Data

The loader puts the query in the cache; the component reads the same options:

```tsx
export const Route = createFileRoute("/_site-layout/_notes-layout/notes")({
  loader: ({ context }) => context.queryClient.ensureQueryData(orpc.note.list.queryOptions()),
  component: NotesPage,
});

function NotesPage() {
  const { data: notes } = useSuspenseQuery(orpc.note.list.queryOptions());
  // ...
}
```

- **`ensureQueryData` in the loader, `useSuspenseQuery` in the component, same options.** The loader makes sure the
  data is there before the page renders (on the server and on navigation); the component subscribes to it, so later
  refetches update the page.
- **Never `useQuery` for render-critical data.** It doesn't run during SSR, so the server renders an empty page and the
  browser fetches again.
- **Components don't read query data through `Route.useLoaderData()`.** Loader data is a snapshot; invalidating the
  query wouldn't update it. A loader may still return what `ensureQueryData` resolved when the route's `head` needs it
  (a record's title for the page meta, [seo.md](./seo.md)).
- **Independent queries load in parallel**: `await Promise.all([ensureQueryData(a), ensureQueryData(b)])`.
- **Data that only some interactions need** (a dialog's details, the next page of results) can use `useQuery` or
  `queryClient.prefetchQuery` from an event handler. It isn't part of the server render.
- **Route context** passes what a guard already loaded to the routes below it: `notes_layout` returns `{ viewer }`
  from `beforeLoad`, and the notes page reads it with `Route.useRouteContext()`.

### Search-Driven Data

When the data depends on search params (filters, a page number), validate them with `validateSearch` and pass the
ones the loader uses through `loaderDeps`, so a change reruns the loader and keys the query
([search-params.md](./search-params.md)):

```tsx
export const Route = createFileRoute("/_site-layout/products")({
  validateSearch: productSearchSchema,
  loaderDeps: ({ search: { q, page } }) => ({ q, page }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(orpc.product.list.queryOptions({ input: deps })),
  component: ProductsPage,
});

function ProductsPage() {
  const { q, page } = Route.useSearch();
  const { data } = useSuspenseQuery(orpc.product.list.queryOptions({ input: { q, page } }));
  // ...
}
```

Return only the params the loader uses from `loaderDeps`; anything else would refetch for no reason.

## Preloading

`defaultPreload: "intent"` (`app/router.tsx`): hovering or focusing a `<Link>` runs the target route's `beforeLoad`
and `loader` ahead of the click. With `defaultPreloadStaleTime: 0` the router always calls the loader, and Query's
`staleTime` decides whether anything is fetched:

- Data still fresh in the cache: the preload fetches nothing, and the click renders at once.
- Data stale or missing: the preload fetches it into the cache, and the click uses that result. A click while the
  preload is still running joins it instead of starting a second request.

A link can opt out (`preload={false}`), or preload as soon as it is visible (`preload="viewport"`) on pages where
the next step is almost certain.

## Freshness

A cache needs a rule for when it refetches. Split by who made the change:

- **Changes the visitor makes**: the mutation invalidates the queries it changed (below). `staleTime` isn't involved.
- **Changes made elsewhere** (another user, an admin, a background job): no mutation in this browser knows about them,
  so `staleTime` covers them. The default is **5 minutes** (`app/router.tsx`). A query whose data others change and
  that should show it sooner sets a shorter one in its options:

  ```ts
  orpc.order.status.queryOptions({ input: { id }, staleTime: 30_000 });
  ```

- **Window focus** refetches stale queries when the tab regains focus (Query's default). Use
  `refetchOnWindowFocus: "always"` for a query that should refresh on every focus.
- **Polling** (`refetchInterval`) only for data that is expected to change while the page is open (a job's
  progress).

## After a Mutation

Every mutation invalidates the query keys it changes; a missed key shows stale data until its `staleTime` runs out.

```tsx
const queryClient = useQueryClient();
const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.note.list.key() });
```

- `orpc.<feature>.<procedure>.key()` is the key of that procedure's queries, all inputs included;
  `orpc.<feature>.key()` covers every procedure of the feature. Invalidate the narrowest key that covers the change.
- Invalidation refetches the queries the page is showing right away, and marks the rest stale, so they refetch the
  next time they are used.
- Slice components that own a mutation tell the page through a callback (`onCreated`, `onDeleted`), and the page
  decides what to invalidate (`app/routes/notes/notes.tsx`).
- `router.invalidate()` reruns the matched routes' `beforeLoad` and `loader`. It is only needed when a guard's input
  changed, and the cache usually handles that already.

### Sign-In and Sign-Out

The session isn't an oRPC mutation, so the auth flows update the cache themselves:

- **Sign-in** (`app/routes/auth/auth.tsx`): invalidate the viewer query, wait for the refetch, then navigate to
  `redirectTo`. The header updates, and the next page's guard sees the session.
- **Sign-out** (`app/hooks/use-sign-out.ts`): navigate home, set the viewer to `null`, then remove every other query,
  so the next account on the device can't see this one's data. Removing a query while its page is mounted would
  refetch it without a session, which is why it happens after leaving.

## Guards

A layout's `beforeLoad` loads the viewer and redirects when the page isn't for them (`app/routes/notes_layout/`):

```tsx
beforeLoad: async ({ context, location }) => {
  const viewer = await context.queryClient.ensureQueryData(viewerQueryOptions);
  if (!viewer) throw redirect({ to: "/auth", search: { redirectTo: location.href } });
  return { viewer };
},
```

A guard only shapes navigation. It reads the cached viewer, which can be up to `staleTime` old, and it runs in the
browser. The data is protected where it is served: every procedure checks the session and role again
(`requireUserMiddleware`, `requireRoleMiddleware`).

## Pending and Error States

- A route can set `pendingComponent` for slow loaders; it shows after `pendingMs` (1 s by default), so fast
  navigations don't flash a spinner.
- A loader error renders the nearest `errorComponent` (the root's by default, `app/root.tsx`). An oRPC error arrives
  as `ORPCError`; a page can catch the expected ones (`NOT_FOUND`) and throw `notFound()` instead.
- Inside a page, mutation errors go through `describeApiFailure` to the form ([architecture.md](./architecture.md) →
  Forms).

## Checklist for a New Page

1. Add the procedure the page reads ([backend-flow.md](../backend-flow.md)).
2. In the route's `loader`, `ensureQueryData` each query the page renders; in the component, `useSuspenseQuery` the
   same options.
3. If search params drive the data, validate them and pass them through `loaderDeps`.
4. If the page's data changes elsewhere and should show soon, give its query a shorter `staleTime`.
5. Make every mutation invalidate the keys it changes.
6. Check the network tab: the first load makes no `/rpc` request (SSR filled the cache), a hover on a link to a fresh
   page makes none either, and a mutation refetches only what it changed.
