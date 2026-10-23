# Search Params (URL State)

TanStack Router validates and types search params itself, so the URL stays the source of truth with no extra library:
a page can be shared, bookmarked, reloaded, and rendered on the server in the same state. Prefer URL state for any view
state a user would expect to survive a reload or a shared link: filters, search text, sorting, pagination, the active
tab, the selected item, and open detail panels.

See the table in [`jotai.md`](./jotai.md#what-goes-where) for what belongs in the URL and what doesn't.

## Defining the Schema

Each route that uses URL state validates it with `validateSearch`. The schema lives in the slice's `search-params.ts`
(or inline in the route file while it is small), and it is the single definition for the route's loader, components
and links:

```ts
// src/routes/orders/search-params.ts
import { z } from "zod";

export const ORDER_SORTS = ["date", "amount"] as const;

export const ordersSearchDefaults = { q: "", sort: "date", page: 1 } as const;

export const ordersSearchSchema = z.object({
  q: z.string().trim().max(100).default(ordersSearchDefaults.q).catch(ordersSearchDefaults.q),
  sort: z.enum(ORDER_SORTS).default(ordersSearchDefaults.sort).catch(ordersSearchDefaults.sort),
  page: z.coerce.number().int().min(1).default(ordersSearchDefaults.page).catch(ordersSearchDefaults.page),
});
```

```tsx
// src/routes/orders/orders.tsx
export const Route = createFileRoute("/_site-layout/orders")({
  validateSearch: ordersSearchSchema,
  // Keeps default values out of the URL: `/orders`, not `/orders?q=&sort=date&page=1`.
  search: { middlewares: [stripSearchParams(ordersSearchDefaults)] },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(orpc.order.list.queryOptions({ input: deps })),
  component: OrdersPage,
});
```

- **`.catch()` on every field.** A hand-edited or outdated link must not break the page: an invalid value falls back
  instead of throwing.
- **Defaults stay out of the URL.** The router writes validated values back into the URL; `stripSearchParams` with
  the same defaults removes them again. Without it, opening `/orders` redirects to the long form.
- **Optional instead of a default** when "absent" means something different from any value. `redirectTo` on the
  sign-in page is `undefined` when missing, and the page applies its fallback where it uses it
  (`redirectToParam` in `src/lib/search-params.ts`).
- **Parse, don't trust.** Values from the URL are user input. Same-site redirect targets go through
  `redirectToParam`; ids are validated like any other input, and the procedure checks access again.
- **Shared parsers** that more than one route needs live in `src/lib/search-params.ts`.

## Reading in Loaders

A loader sees search params only through `loaderDeps`. Return exactly the params the loader uses: a change to one of
them reruns the loader and changes the query key, and a change to anything else doesn't
([data-loading.md](./data-loading.md) → Search-Driven Data). UI-only params
(an open panel, the active view) simply stay out of `loaderDeps`.

## Reading and Writing in Components

Read with `Route.useSearch()`, using `select` when a component needs one value. Write with `navigate`, passing a
function so the other params survive:

```tsx
const { sort } = Route.useSearch();
const navigate = Route.useNavigate();

const sortBy = (sort: (typeof ORDER_SORTS)[number]) =>
  navigate({ search: (prev) => ({ ...prev, sort, page: 1 }), replace: true });
```

A filter change resets `page` to 1, or the page could land past the end of the new results.

### Text Inputs

Keep the input's text in local state, and write it to the URL after a pause, so typing doesn't run the loader on each
key:

```tsx
const { q } = Route.useSearch();
const navigate = Route.useNavigate();
const [text, setText] = useState(q);

useEffect(() => {
  if (text === q) return;
  const timer = setTimeout(() => navigate({ search: (prev) => ({ ...prev, q: text, page: 1 }), replace: true }), 300);
  return () => clearTimeout(timer);
}, [text, q, navigate]);

<Input value={text} onChange={(event) => setText(event.target.value)} />;
```

## History

`navigate` pushes a history entry by default. Pass `replace: true` for typing, toggling filters, and opening panels.
Keep the push only when the user would expect the Back button to undo the change, such as moving between pages of
results or switching tabs that act like separate pages.

## Building Links

Pass search params to `<Link>` as an object, or as a function of the current ones. Don't concatenate query strings by
hand.

```tsx
<Link to="/orders" search={{ sort: "amount" }}>…</Link>
<Link from={Route.fullPath} search={(prev) => ({ ...prev, page: prev.page + 1 })}>بعدی</Link>
```

A link that keeps the current pathname only changes the query, so it doesn't fade (see
[`view-transitions.md`](./view-transitions.md)).

## Forms Without JavaScript

When a filter form must work before hydration, use a plain `<form method="get">` with field names that match the
schema's keys. The server parses the resulting URL with the same `validateSearch`.

## Where Code Lives

- `search-params.ts` lives in its route's slice. Move a parser to `src/lib/search-params.ts` only when a second route
  reads the same params. Never import from another route's slice.
- Shared components in `src/components/` don't read the URL. They take values and callbacks through props, so they
  stay reusable and easy to preview in Storybook.

## Don'ts

- Don't read search params with `window.location` or `URLSearchParams`; they skip validation and don't update the
  page.
- Don't put secrets, tokens, or personal data in the URL. It ends up in history, logs, and shared links.
- Don't put large objects in the URL. Store an id and load the rest.
- Don't copy URL state into `useState` or atoms (a text input's draft is the exception). Read it from the route where
  it's needed.

## Testing

A schema with real rules (a redirect target, a page range) gets a unit test of `schema.parse(...)` for the inputs that
matter. Don't test zod itself.
