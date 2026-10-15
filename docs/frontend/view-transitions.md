# View Transitions (Page Fade)

Client navigations to another page fade between the old and new page. This uses React's
[`<ViewTransition>`](https://react.dev/reference/react/ViewTransition) (stable since React 19.3), not React Router's
`viewTransition` option. Browsers without the View Transition API navigate as usual, without the fade.

## How It Works

The site layout (`app/routes/site_layout/site-layout.tsx`) wraps its `<Outlet>` in one boundary:

```tsx
<ViewTransition key={pathname} enter="page" exit="page" default="none">
  <Outlet />
</ViewTransition>
```

- React only animates updates that run inside a Transition. React Router commits every navigation's state update in
  `React.startTransition`, so any client navigation qualifies: `<Link>`, `<NavLink>`, `<Form>`, `navigate()`,
  redirects from actions, and Back/Forward.
- **The key decides what fades.** A new pathname swaps the boundary, which plays `exit` on the old page and `enter`
  on the new one. Anything that keeps the pathname keeps the boundary, and `default="none"` makes those updates
  instant.
- The fade starts after the loaders finish, when the new page is ready to render. It doesn't replace pending UI for
  slow loaders.

| Navigation                             | Fades? |
| -------------------------------------- | ------ |
| To another pathname (`/` → `/orders`)  | Yes    |
| Back/Forward to another pathname       | Yes    |
| Same pathname, new query (`"?page=2"`) | No     |
| Same pathname, new hash (`"#details"`) | No     |
| nuqs updates, revalidations, fetchers  | No     |

Use `Link`, `NavLink`, `Form` and `useNavigate` straight from `react-router`. Nothing needs to opt in.

- **Same route, new params remount.** `/orders/1` → `/orders/2` is a new pathname, so the page mounts fresh and its
  local state resets. That is usually what a different record should do.

## Styling

- The duration lives in `app.css`, on the `page` class and `root`. It is kept short because the page ignores clicks
  while the fade runs.
- `prefers-reduced-motion: reduce` turns the animation off, so navigation is instant.
- `app.css` pins the `::view-transition` overlay with `left: 0; right: auto`. React shrinks the overlay to 0×0, and in
  this RTL document the browser's `inset: 0` then anchors it to the right edge, which paints every snapshot
  off-screen: the page vanishes and reappears instead of fading. Keep that rule.
- The header and footer stay in the `root` snapshot. They look the same on both pages, so the cross-fade keeps them
  visually steady.

## Animating More

Put another `<ViewTransition>` inside a page for element-level motion. Inner boundaries animate on their own; the
page boundary's `default="none"` only covers the page itself.

- **Morph an element between pages:** wrap it in `<ViewTransition name="note-42">` on both pages. A name must be
  unique among mounted boundaries, so build it from the record's id.
- **Animate list changes on the same page** (a filter, a deleted item): wrap each item in a keyed `<ViewTransition>`.
  These updates only animate when they run in a Transition. nuqs and React Router's revalidation already do; wrap
  your own state updates in `startTransition`.
- Style with the class props (`enter`, `exit`, `update`, `share`) and `::view-transition-old(.your-class)` /
  `::view-transition-new(.your-class)` in CSS.

## Don'ts

- Don't pass React Router's `viewTransition` option (`<Link viewTransition>`, `navigate(to, { viewTransition: true })`,
  `useViewTransitionState`). It calls `document.startViewTransition()` itself, and a second view transition skips the
  one React started.
- Don't call `document.startViewTransition()` yourself, for the same reason.
- Don't remove `default="none"` from the page boundary. Without it, every filter change and revalidation would fade
  the whole page.
- Don't add `@view-transition { navigation: auto; }`. It only affects full page loads between documents, not client
  navigations.

## PWA Notes

- A service worker doesn't affect view transitions. It works on the network layer (documents, assets, and loader
  data requests), and the fade is in-page rendering. An installed PWA uses the same browser engine, so the fade works
  the same way.
- **Test the iOS swipe-back gesture on a real device.** iOS plays its own animation for a swipe back, and the page
  then fades too, which can look like a double animation. If it shows up, skip the fade when the browser already
  animated, which `PopStateEvent.hasUAVisualTransition` reports.
