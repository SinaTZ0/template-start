# Frontend Architecture (TanStack Start)

The frontend is organized by route. Each route slice owns everything that only it uses, and code moves to a shared
location only when a second consumer needs it. The UI is in Persian and right-to-left.

These are the rules. The steps for building a page are in [frontend-flow.md](../frontend-flow.md).

## Structure

```text
src/
  routes.ts                 # virtual route config (set in tsr.config.json): maps URLs to route files
  routeTree.gen.ts          # generated from routes.ts by the Start plugin; never edit
  router.tsx                # getRouter(): the router, its QueryClient and preload defaults
  start.ts                  # global server-function middleware
  server.ts                 # server entry: request trace, X-Request-Id, request log, background jobs
  client.tsx                # browser entry: error reporting, hydration
  styles.css                # global styles and theme tokens
  routes/
    __root.tsx              # root route: document shell, global providers, error and 404 pages, devtools
    <slice>/                # one flat folder per route
      <slice-name>.tsx      # route file (`export const Route = createFileRoute(...)`)
      components/           # components used only by this route
      hooks/                # hooks used only by this route
      queries.ts            # query options used only by this route
      search-params.ts      # this route's search schema
      atoms.ts              # Jotai atoms used only by this route
      schema.ts             # form schemas owned by this route
  components/
    primitive/              # this app's versions of shadcn components
    shared/                 # app-made UI shared by multiple routes
    ui/                     # shadcn source, reference only
  hooks/                    # hooks shared by multiple routes
  atoms/                    # Jotai atoms shared by multiple routes
  lib/                      # shared helpers (browser-safe, or *.server.ts)
  orpc/client.ts            # isomorphic API client and query utilities (see ./data-loading.md)
```

Not every slice needs every file. Start with the route module alone and split it out as it grows.

## Route Slices

- **Flat, not nested.** URL hierarchy does not imply folder nesting: use `dashboard_user/`, never `dashboard/user/`.
  Nesting of layouts is expressed in `routes.ts` (virtual file routes: `rootRoute`, `layout`, `index`, `route`), not
  in the file tree. Paths use `$param` for params, `{-$param}` for optional ones and `$` for a catch-all.
- **One route per file.** Each route file exports `Route` from `createFileRoute(<id>)`. The Start plugin rewrites the
  id string to match `routes.ts` when it generates `routeTree.gen.ts`, so a new file can start with any id.
- **Colocate.** The route file, its options (`beforeLoad`, `loader`, `loaderDeps`, `validateSearch`, `head`,
  `component`, `pendingComponent`, `errorComponent`, `notFoundComponent`, `server.handlers`), and its private
  components, hooks, queries, and schemas all live in its slice.
- **Promote only when shared.** Move code to `src/components/shared/`, `src/hooks/`, or `src/lib/` only when multiple
  routes use it or it clearly belongs to a broader domain. Never import from another route's slice; promote instead.
- **Let types flow from the route.** Read params, search, loader data and route context through the `Route` object
  (`Route.useSearch()`, `Route.useRouteContext()`) or hooks with `from`. Don't annotate or cast what the router
  infers.

## Data and the Server Boundary

The full rules are in [data-loading.md](./data-loading.md). In short:

- **TanStack Query is the cache.** Loaders fill it with `context.queryClient.ensureQueryData(options)`; components
  read the same options with `useSuspenseQuery`. Pages render fully on the server, and the browser hydrates from the
  same cache.
- **Loaders are isomorphic.** They run on the server for the first request and in the browser afterwards, so route
  files never import server-only modules. Feature data comes from oRPC procedures through
  `orpc.<feature>.<procedure>.queryOptions()`; small framework reads use `createServerFn`. Never call the API with a
  hand-written `fetch`.
- **Mutations invalidate what they change**: `useMutation(orpc.note.create.mutationOptions(...))`, then
  `queryClient.invalidateQueries({ queryKey: orpc.note.list.key() })`. Don't patch local copies.
- **Guards** are a layout's `beforeLoad`: it loads the viewer (`viewerQueryOptions`, `src/lib/viewer.ts`) and throws
  `redirect(...)`. What it returns becomes route context for the routes below. Procedures check auth again on their
  own.
- **Server-only code** uses the `.server.ts` suffix; Start's import protection fails the build when browser-reachable
  code imports it. Secrets and environment values never reach a component.
- The frontend may import browser-safe backend files (contracts, `constants.ts`, `*.errors.ts`) for types and shared
  option values, never services, repositories, or `*.server.ts` files.

## State

- Server data belongs to TanStack Query. Shareable view state belongs in URL search params, and form input belongs to
  the form.
- Local state uses `useState` and props. Use Jotai only for client state shared across distant parts of the tree.
- See [`jotai.md`](./jotai.md) for how to define, place, and use atoms.
- URL state goes through the route's `validateSearch` schema, read with `Route.useSearch()` and changed with
  `navigate({ search })`. See [`search-params.md`](./search-params.md).

## Navigation

- Use `Link` and `useNavigate` from `@tanstack/react-router`. `to` is checked against the route tree; pass params
  and search as objects (`<Link to="/auth" search={{ redirectTo }}>`). An active link gets `aria-current="page"` and
  `data-status="active"`; style those instead of a separate `NavLink`. For hrefs that come from content data, use
  `SiteLink` (`src/components/shared/site-link/`).
- Moving to another pathname fades the page and slides it in the direction of travel on its own; search and hash
  updates stay instant. See [`view-transitions.md`](./view-transitions.md). Don't pass the router's `viewTransition`
  option: it replaces the default for that navigation.

## Forms

- Forms use `react-hook-form` with `zodResolver` and the `Field` primitives (`Field`, `FieldLabel`, `FieldError`).
- Each form has its own schema in its route's `schema.ts`, written for user experience (messages, when to validate).
  Do not derive it from backend validation, even when the rules currently match; update both explicitly when a
  requirement changes.
- Shared option lists (select values, limits) are imported from the feature's browser-safe constants.
- The server is the final authority. `describeApiFailure` (`src/lib/api-error.ts`) turns an API error into per-field
  messages, shown next to the matching fields, and a general message for the form's `FormAlert`.
- Disable submission while pending and keep the user's input after a failure.

## Components

- One component per file. File names are kebab-case; component names are PascalCase.
- Shared components (`src/components/`) receive page data and callbacks through props and don't fetch, read route
  atoms or URL state, which keeps them reusable and easy to preview. The exception is an app-wide action with one
  meaning everywhere, through a hook in `src/hooks/` (the header's `useSignOut`, the toggle's `useTheme`).
- Inside a route slice, loading stays in the route file. A slice component may own the mutation it triggers (the
  note form calls `useMutation` itself) and tells the page through a callback such as `onCreated`; the page decides
  which queries to invalidate.
- Primitives and visible shared components have Storybook stories. Stories are maintained UI documentation; keep them
  in sync with the component.
- Handle every state a user can see: loading, empty, error, and success.
- Creating, changing and linting primitives: see [components.md](./components.md).

## Persian, RTL, and Accessibility

- The document is `lang="fa"` and `dir="rtl"`. All user-facing text is Persian; code identifiers and developer
  diagnostics stay in English.
- Use logical directions, never physical ones: Tailwind `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`
  instead of `ml-`, `pl-`, `left-`, `text-left`. Mirror directional icons.
- Format numbers with `formatNumberFa` and dates with `Intl` and the `fa-IR` locale. Inputs that accept numbers must
  accept Persian and Arabic digits: normalize them with `toLatinDigits` before parsing. Both helpers are in
  `src/lib/digits.ts`.
- Use semantic elements and native controls first. Every input has a label, every action is keyboard-reachable, and
  errors are announced to assistive technology.

## Styling

- Style with Tailwind utilities. Put design tokens (colors, fonts, spacing scale) in `styles.css` instead of hard-coding
  values in components.
- Extract a component when a pattern repeats, not a utility class.
