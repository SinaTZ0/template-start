# nuqs (URL State)

nuqs gives URL search params types, defaults, and update options. The URL stays the source of truth, so a page can be
shared, bookmarked, reloaded, and rendered on the server in the same state. The root `Layout` mounts the React Router
v8 adapter (`<NuqsAdapter>`). Prefer URL state for any view state a user would expect to survive a reload or a shared
link: filters, search text, sorting, pagination, the active tab, the selected item, and open detail panels.

See the table in [`jotai.md`](./jotai.md#what-goes-where) for what belongs in the URL and what doesn't.

## Shallow vs. Revalidating Updates

nuqs itself defaults to `shallow: true`, which updates the URL without running loaders. This app sets
`shallow: false` on the root adapter, because most URL state here filters loader data.

| Param                                                     | Option                            |
| --------------------------------------------------------- | --------------------------------- |
| Read by the loader (filters, search text, sort, page)     | Default (`shallow: false`)        |
| UI-only, never read by a loader (open panel, active view) | `.withOptions({ shallow: true })` |

A shallow param that the loader actually reads leaves the page showing stale data. A param that revalidates when it
didn't need to only costs one extra loader request. When unsure, keep the default.

## Defining Parsers

Each route that uses URL state has a `search-params.ts` in its slice. It is the single definition shared by the
loader and the components, so server and client always parse the same way.

- **Import from `nuqs/server`** in `search-params.ts`. It has the parsers and `createLoader` without the client hooks,
  and it is safe to import on both the server and the client.
- **Give every param a default** with `.withDefault()` unless "absent" has its own meaning. Defaults are removed from
  the URL (`clearOnDefault` is on), so `/orders` and `/orders?page=1` are the same page.
- **Use `parseAsStringLiteral`** for fixed options, with English values. Keep keys short, English, and stable, because
  they become part of shared links. User-entered text, such as Persian search terms, is encoded automatically.
- **Name the exports** `<slice>SearchParams` for the parser map and `load<Slice>SearchParams` for the loader.

```ts
// app/routes/orders/search-params.ts
import { createLoader, parseAsInteger, parseAsString, parseAsStringLiteral } from "nuqs/server";

export const orderSortOptions = ["newest", "oldest", "amount"] as const;

/*===== Parsers =====*/
export const ordersSearchParams = {
  q: parseAsString.withDefault(""),
  page: parseAsInteger.withDefault(1),
  sort: parseAsStringLiteral(orderSortOptions).withDefault("newest"),
};

/*===== Server Loader =====*/
export const loadOrdersSearchParams = createLoader(ordersSearchParams);
```

Parsers turn invalid values into the default (`?sort=foo` becomes `"newest"`), but they don't check business rules.
`?page=-3` parses as `-3`, so the loader clamps or validates values before using them.

## Reading in Loaders

```ts
export async function loader({ request }: Route.LoaderArgs) {
  const { q, page, sort } = loadOrdersSearchParams(request);
  // ...
}
```

The loader parses the request URL directly. Don't read params with `new URL(request.url).searchParams` for keys that
have parsers.

## Reading and Writing in Components

- Use `useQueryStates(<slice>SearchParams)` when a component works with several related params. It batches updates
  into one URL change and one loader run.
- Use `useQueryState("key", parser)` for a single param.
- Set a value to `null` to remove it from the URL and return to its default.
- **Reset dependent params in the same update.** Changing a filter or the search text sets `page: null`, so the user
  isn't left on a page that no longer exists.

```tsx
const [{ sort }, setSearchParams] = useQueryStates(ordersSearchParams);

setSearchParams({ sort: "amount", page: null });
```

### Text Inputs

The state updates on every keystroke, but debounce the URL so typing doesn't run the loader on each key:

```tsx
import { debounce, useQueryStates } from "nuqs";

const [{ q }, setSearchParams] = useQueryStates(ordersSearchParams);

<Input
  value={q}
  onChange={(event) => setSearchParams({ q: event.target.value, page: null }, { limitUrlUpdates: debounce(300) })}
/>;
```

### UI-only State

```tsx
const [panel, setPanel] = useQueryState(
  "panel",
  parseAsStringLiteral(["details", "history"]).withOptions({ shallow: true }),
);
```

## History

Updates replace the current history entry by default. Use `history: "push"` only when the user would expect the Back
button to undo the change, such as moving between pages of results or switching tabs that act like separate pages.
Typing, toggling filters, and opening panels keep `replace`.

## Building Links

Use `createSerializer` with the same parser map to build URLs for `<Link>` and redirects. Don't concatenate query
strings by hand.

```ts
// search-params.ts (createSerializer is imported from "nuqs/server")
export const serializeOrdersSearchParams = createSerializer(ordersSearchParams);

// component
<Link to={serializeOrdersSearchParams("/orders", { sort: "amount" })}>...</Link>;
```

The link keeps the current pathname and only changes the query, so it doesn't fade, like other nuqs updates (see
[`view-transitions.md`](./view-transitions.md)).

## Forms Without JavaScript

nuqs needs JavaScript. When a filter form must work before hydration, use `<Form method="get">` with field names that
match the parser keys. The loader parses the result with the same `load<Slice>SearchParams`.

## Where Code Lives

- `search-params.ts` lives in its route's slice. Move it to `app/search-params/<domain>.ts` only when a second route
  reads the same params. Never import from another route's slice.
- Shared components in `app/components/` don't call nuqs hooks. They take values and callbacks through props, so they
  stay reusable and easy to preview in Storybook.

## Don'ts

- Don't mix React Router's `setSearchParams` with nuqs for the same keys. Two writers overwrite each other.
- Don't put secrets, tokens, or personal data in the URL. It ends up in history, logs, and shared links.
- Don't put large objects in the URL with `parseAsJson`. Store an id and load the rest.
- Don't copy URL state into `useState` or atoms. Read it from nuqs where it's needed.

## Testing

Wrap components with `withNuqsTestingAdapter({ searchParams: "?sort=amount" })` from `nuqs/adapters/testing`, and
check its `onUrlUpdate` callback when the URL change is the behavior under test. Don't test the built-in parsers.
