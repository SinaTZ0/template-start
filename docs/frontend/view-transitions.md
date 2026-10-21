# View Transitions (Page Fade)

Client navigations to another page fade between the old and new page. The router starts the
[View Transition](https://developer.mozilla.org/docs/Web/API/View_Transition_API) itself, through
`defaultViewTransition` in `app/router.tsx`. Browsers without the View Transition API navigate as usual, without the
fade.

## How It Works

```ts
defaultViewTransition: { types: ({ pathChanged }) => (pathChanged ? ["page"] : false) },
```

- **The pathname decides what fades.** When a navigation changes the pathname, the router wraps its commit in
  `document.startViewTransition` with the type `page`, and the whole document cross-fades. Anything that keeps the
  pathname (a new search param, a hash, a refetch) gets `false` and updates instantly.
- Every client navigation qualifies: `<Link>`, `navigate()`, redirects from `beforeLoad`, and Back/Forward. Nothing
  needs to opt in.
- The fade starts after the loaders finish, when the new page is ready to render. It doesn't replace pending UI for
  slow loaders.
- Browsers that support view transitions but not transition types (`:active-view-transition-type()`) skip the
  `types` function, so every navigation fades there, search changes included.

| Navigation                            | Fades? |
| ------------------------------------- | ------ |
| To another pathname (`/` → `/orders`) | Yes    |
| Back/Forward to another pathname      | Yes    |
| Same pathname, new query (`?page=2`)  | No     |
| Same pathname, new hash (`#details`)  | No     |
| Query refetches and invalidations     | No     |

- **Same route, new params remount.** `/orders/1` → `/orders/2` is a new pathname, so the page fades and mounts fresh,
  and its local state resets. That is usually what a different record should do.

### Why Not React's `<ViewTransition>`

React only animates updates that run inside a Transition. TanStack Router commits navigations inside
`React.startTransition`, but components read the location and matches through external stores
(`useSyncExternalStore`), and React always applies those updates synchronously. A page-level `<ViewTransition>` keyed
on the pathname therefore never activates on navigation, so the router's own option does the page fade.

## Styling

- The duration lives in `app.css`, on `root`. It is kept short because the page ignores clicks while the fade runs.
- `prefers-reduced-motion: reduce` turns the animation off, so navigation is instant.
- The header and footer are part of the `root` snapshot. They look the same on both pages, so the cross-fade keeps
  them visually steady.
- To style only page fades, scope rules with `:active-view-transition-type(page)`.

## Animating More

- **Morph an element between pages:** give it the same `view-transition-name` on both pages, built from the record's
  id (`note-42`), since a name must be unique on the page. The page fade then animates that element from its old box
  to its new one.
- **Animate changes on the same page** (a filtered list, a deleted item): React's `<ViewTransition>` works for state
  updates you start with `startTransition`. Query refetches don't run in a Transition, so a list that changes after an
  invalidation doesn't animate on its own.

## Don'ts

- Don't call `document.startViewTransition()` around a navigation, or pass `viewTransition` to a `<Link>` or
  `navigate()` on top of the default: a second view transition skips the first.
- Don't add `@view-transition { navigation: auto; }`. It only affects full page loads between documents, not client
  navigations.

## iOS Swipe-Back

**Test the iOS swipe-back gesture on a real device.** iOS plays its own animation for a swipe back, and the page then
fades too, which can look like a double animation. If it shows up, skip the fade when the browser already animated,
which `PopStateEvent.hasUAVisualTransition` reports.
