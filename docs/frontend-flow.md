# Frontend Flow

Start here for any frontend work. The steps are the technical path for a new page; the design itself is yours to
decide. The `notes` route (`src/routes/notes/`) is the worked example.

| Doc                                                            | Covers                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| [frontend/architecture.md](./frontend/architecture.md)         | Structure, route slices, data, state, forms, RTL, styling  |
| [frontend/data-loading.md](./frontend/data-loading.md)         | Loaders, the Query cache, preloading, freshness, guards    |
| [frontend/app-identity.md](./frontend/app-identity.md)         | Mood, tone, theme tokens, hard constraints                 |
| [frontend/components.md](./frontend/components.md)             | Primitives, shared components, style maps, lint rules      |
| [frontend/search-params.md](./frontend/search-params.md)       | URL state                                                  |
| [frontend/jotai.md](./frontend/jotai.md)                       | Shared client state                                        |
| [frontend/view-transitions.md](./frontend/view-transitions.md) | The page fade and slide, in-page changes CSS can't animate |
| [frontend/seo.md](./frontend/seo.md)                           | Page meta, link previews, what to index, the sitemap       |
| [frontend/i18n.md](./frontend/i18n.md)                         | Messages, Persian and English, direction, numbers, dates   |
| [backend/media.md](./backend/media.md)                         | Uploading and rendering images                             |

## Steps

1. **Design**: decide what the page is for and design it around its real content. Read
   [app-identity.md](./frontend/app-identity.md) for the mood and tone. The existing pages, primitives and tokens are
   a starting point, not a template to repeat: if the design needs something they don't do, change them.
2. **Route and data**: register the route in `routes.ts` and create its flat slice folder with a `createFileRoute`
   file ([architecture.md](./frontend/architecture.md) → Route Slices). If it needs a signed-in user, put it under a
   guarded layout (`notes_layout`), and read the viewer from route context with `Route.useRouteContext()`. Fill the
   Query cache in the `loader` with `context.queryClient.ensureQueryData(orpc.<feature>.<procedure>.queryOptions())`,
   and read the same options in the component with `useSuspenseQuery` ([data-loading.md](./frontend/data-loading.md)).
   Set the page's tags in `head` with `pageMeta(...)` ([seo.md](./frontend/seo.md)), with its title and description
   as messages.
   - The page's data comes from oRPC procedures. If one it needs doesn't exist yet, add it first with
     [backend-flow.md](./backend-flow.md).
   - Shareable view state (filters, tabs, pagination) goes in the URL through the route's `validateSearch`
     ([search-params.md](./frontend/search-params.md)); client state shared across distant parts of the tree goes in
     [Jotai](./frontend/jotai.md).
3. **UI**: build it from primitives (`components/primitive/`), shared components (`components/shared/`) and the
   slice's own components. Standard controls use the primitive of the matching shadcn component; create the primitive
   if it doesn't exist yet ([components.md](./frontend/components.md)). Build the loading, empty, error and success
   states. Every text is a message in `messages/fa.json` and `messages/en.json`, called in render, never at module
   scope; layout uses logical classes so it works in both directions ([i18n.md](./frontend/i18n.md)).
4. **Forms**: add the form's `schema.ts` (each check's message an `error: () => m.<key>()` function), run it with `react-hook-form` and `zodResolver`, and lay fields out with the
   `Field` primitives. Submit with `useMutation(orpc.<feature>.<procedure>.mutationOptions())`, show the server's
   errors through `describeApiFailure`, and invalidate the queries the mutation changed on success. `note-form.tsx` in the notes slice does
   all of this ([architecture.md](./frontend/architecture.md) → Forms). Image fields follow
   [media.md](./backend/media.md).
5. **Promote**: move a slice component to `components/shared/` (or a hook to `src/hooks/`) once a second route needs it.
6. **Check**: look at the page at phone and desktop widths, in light and dark, in Persian and English (`/en/…`), with
   the keyboard, and against
   `WCAG 2.2 AA`. Add a Playwright smoke test if the flow is consequential (forms, critical navigation). Run
   `pnpm lint` and `pnpm typecheck`. In the network tab, the first load makes no `/rpc` request and a mutation refetches
   only what it changed.
