---
name: react-view-transitions
description: How to animate in-page UI changes in this app with React 19.3's stable <ViewTransition> and the browser View Transitions API, where CSS transitions can't follow the change. Covers content swaps of a different height (a form and the receipt that replaces it), enter/exit, content that moves when something above it changes, list filter/reorder, shared-element morphs, typed transitions, and how they live beside the router's page fade. Use whenever a change should animate and CSS can't do it, when the user mentions view transitions, ViewTransition, startViewTransition, addTransitionType or startTransition-driven animation, or asks for motion without an animation library. Includes the known pitfalls (hydration animating, focus/scroll mid-capture, sticky elements, double exposure) and how to verify a transition frame by frame in headless Chromium.
---

# React View Transitions

Animate with the platform, not a library. View transitions run in the browser's compositor, and browsers without them
still get the state change, just without the animation. Do not add Motion (framer-motion), react-spring, GSAP or
similar.

When to use a view transition at all, and when CSS or the router's page fade does the job, is decided in
`docs/frontend/view-transitions.md` → Animating More (and the project's motion rules in `docs/frontend/app-identity.md`,
once it has them). This skill is the how.

## Ground Truth for This Repo

- React is **19.3** or later (`react`, `react-dom` in `package.json`). `ViewTransition` and `addTransitionType` are **stable**:
  `import { addTransitionType, startTransition, ViewTransition } from "react"`. Do not install `react@canary` or use
  the `unstable_` names. Older guides, Vercel's `react-view-transitions` skill among them, still say canary is
  required; ignore that.
- Styles are **Tailwind v4 with one global stylesheet**. View-transition rules go in `src/styles.css`, under
  `/*===== Motion =====*/`, as a `/*------ Name ------*/` block next to the page-fade rules. Name the classes after
  the feature (`form-card`, `form-body`) so they read as this app's, not a library's.
- The app is **Persian first (RTL) with English (LTR)** at `/en/...`. Test both. Directional motion uses the
  direction, not fixed left/right: the page slide flips `--page-shift` under `dir="rtl"`; do the same.
- **Already in `src/styles.css`**, keep them when refactoring:
  - the root cross-fade at 200ms (`::view-transition-group(root)` …). It applies to React's transitions too: whatever
    is outside a named boundary cross-fades in 200ms.
  - reduced motion: `animation: none !important` on every `::view-transition-*` pseudo-element.
- **The running example** below is a form that swaps to its receipt after sending, and back for «send another». It has
  every hard part: a different height, focus moving to the new content, a sticky element, and state that comes from a
  mutation.
- Keep durations short (about 200ms, like the page fade): named parts can't be clicked while they run.

## The Model

1. **Trigger**: a React Transition: `startTransition(() => setX(…))`, `useDeferredValue`, or a Suspense reveal. A plain
   `setState` does not animate, and `flushSync` actively **skips** the animation.
2. **Declare**: wrap what should animate in `<ViewTransition>`. React gives the nearest DOM node(s) a unique
   `view-transition-name` only for the duration of the transition, and calls `document.startViewTransition` itself
   (an instant update where unsupported).
3. **Style**: the props are view-transition _classes_, styled through the pseudo-elements in `src/styles.css`:

| Prop      | Fires when the `<ViewTransition>` …                                                       |
| --------- | ----------------------------------------------------------------------------------------- |
| `enter`   | is **mounted** inside a transition                                                        |
| `exit`    | is **unmounted** inside a transition                                                      |
| `update`  | its content mutated, or it moved or resized because of a sibling                          |
| `share`   | a same-`name` boundary unmounts elsewhere while this one mounts (morph)                   |
| `default` | any of the above without its own prop; `"none"` disables, `"auto"` is the browser default |

```css
::view-transition-group(.list-move) {
  animation-duration: 300ms;
}
::view-transition-new(.panel-open):only-child {
  animation: panel-open 300ms ease-out both; /* enter */
}
::view-transition-old(.panel-open):only-child {
  animation: panel-open 200ms ease-in reverse both; /* exit */
}
```

`:only-child` targets a pure enter (no old image) or a pure exit (no new image).

When CSS is not enough, the event props `onEnter`, `onExit`, `onUpdate`, `onShare` receive the instance and can drive
the pseudo-elements with the Web Animations API; return a cleanup function.

### Always Type the Transition

**Hydration runs as a Transition.** A boundary with a plain `update="…"` animates on every page load, as soon as
anything inside it differs from the server HTML (a custom element upgrading, a client-only value). Tag the transitions
that should animate and let every other one through untouched:

```tsx
const FORM_SWAP = "form-swap";

export function swapFormBody(update: () => void) {
  startTransition(() => {
    addTransitionType(FORM_SWAP);
    update();
  });
}

<ViewTransition default="none" update={{ [FORM_SWAP]: "form-card", default: "none" }}>
```

Export the helper (`swapFormBody`) rather than the type string, so callers can't forget `addTransitionType`. React
also sets the types on the browser's transition, so CSS can branch with `:active-view-transition-type(form-swap)`.

### State From Elsewhere Isn't a Transition

React Query sets `mutation.data`, query data and refetch results outside any Transition, so a view that switches on
them never animates. Keep what is shown in local state and set it inside the typed transition:

```tsx
const [sent, setSent] = useState<typeof submit.data>();
// …after `await submit.mutateAsync(…)` resolves:
swapFormBody(() => setSent(result));
```

The same goes for router state (`useSyncExternalStore`, always synchronous), which is why page navigations use the
router's own option.

## Patterns

**Swap content of a different height** (the running example). One boundary around the whole card would fade the card's
frame along with its content, and it nearly disappears halfway. Split it into nested boundaries, each its own
snapshot:

- the frame (`form-card`): only changes size; its old and new images cross-fade with each other and look solid;
- the body (`form-body`): old out fast, new in after it (see "Overlap looks fuzzy");
- anything that sits at a different spot in the two states, like a sticky rail (`form-rail`): its group slides there
  instead of showing twice.

Give the resizing groups `overflow: clip`: each snapshot keeps its natural height from the top, so a shrinking box
would otherwise spill the taller old image over the page below.

**Expand / collapse (enter + exit).** A panel that opens is a CSS transition first (a Collapsible primitive, or a
`grid-template-rows` transition). Reach for enter/exit only when the content truly mounts and CSS can't follow. Mount and unmount it; toggling `hidden` or
`display` is an update, not an enter. The `<ViewTransition>` must be the **first thing in the mounting subtree, above
any DOM node**: `{open && <ViewTransition><div>…}` works, `{open && <div><ViewTransition>…}` silently never fires.

**Things below that move.** Content that shifts because something above it changed cross-fades inside the root
snapshot, which reads as a jump. Wrap each visible neighbour in its own boundary so its group slides. Only wrap what is
likely on screen.

**Shared element / morph.** Give two boundaries the same `name` (unique on the page): one unmounts while the other
mounts, inside one transition. Style the morph with a `share` class. Between pages, the router's fade morphs any
element with the same `view-transition-name` on both pages (`view-transitions.md` → Animating More).

**Swap in place by key.** Change the `key` on a `<ViewTransition>` to play exit on the old content and enter on the
new (a carousel slide). Use this when old and new are siblings of one kind; for two different views of one place
(form and receipt), use `update` as above.

**Directional motion.** `addTransitionType("next")` inside `startTransition`, then a map on the prop:
`enter={{ next: "from-end", previous: "from-start", default: "none" }}`. Build the offset from a variable that flips
under `dir="rtl"`, as `--page-shift` does. Save directional slides for ordered sequences, not sibling tabs.

**Loading (Suspense).** `<ViewTransition update="auto" default="none"><Suspense fallback={…}>…</Suspense></ViewTransition>`
shows the fallback at once and animates only the fallback → content swap. Use it sparingly: route data comes from
loaders and is usually ready before render (`docs/frontend/data-loading.md`).

**Nesting.** When a parent boundary mounts or unmounts as one unit, nested boundaries do not fire their own
enter/exit; only the outermost animates. For `update`, each nested boundary animates on its own, which is what the
form swap relies on.

**Sliding indicators.** Slide a tab or segment indicator with a CSS transition; don't rebuild one as a morph. If a shape
ever has to morph, paint the group instead of the stretched snapshot (see "A stretched snapshot blurs").

## Pitfalls

- **Hydration animates untyped boundaries.** See "Always Type the Transition".
- **Focus and scroll belong in `useLayoutEffect`.** The browser captures the new state right after React's layout
  effects. A `focus()` that scrolls from `useEffect` lands mid-animation: the page moves under fixed snapshots, and
  named elements end where the page no longer has them, then pop. A receipt that takes focus does it in
  `useLayoutEffect` for this reason.
- **Sticky elements are captured with a stale scroll** when the page gets shorter and the browser clamps the scroll in
  the same update. The fix is the same: settle the scroll in `useLayoutEffect` so the capture sees the final scroll.
  Read the group keyframes (see Verifying) to confirm the end position is on screen.
- **Overlap looks fuzzy.** Two half-transparent snapshots of different content read as a double exposure. For a
  content swap, run them in sequence: old out in ~120ms, new in after the same delay. Frames and shapes that are the
  same in both states can keep the plain cross-fade.
- **`flushSync`** inside the update skips the transition. Use `startTransition`.
- **Names must be unique** among elements captured in one transition. Let React generate them; pass `name` only for
  morphs. The router names `#main` `page` during forward and back navigations; don't reuse it.
- **Start latency**: React schedules the transition, so it begins ~100–150ms after the click. That is normal.
- **Interactivity**: during the animation, named parts can't be clicked and the overlay can swallow clicks. Keep it
  short. `::view-transition { pointer-events: none; }` passes clicks through to unnamed content if ever needed.
- **Snapshots are images**: text in an animating group cross-fades between old and new, and a changing aspect ratio
  stretches. Keep elements whose text changes outside named groups, or accept the brief cross-fade.
- **`useDeferredValue` is a Transition too.** Keep boundaries off frequently-updating UI such as search, or type
  them so it can't trigger them.
- **Groups stack in the old state's paint order**, not by intent. A moving group covers every named sibling painted
  before it, so the bug shows in one direction only. Give what must stay on top `z-index: 1` inside a parent with
  `isolation: isolate`.
- **A stretched snapshot blurs.** A rounded fill that changes width smears its ends. For a plain shape, hide the
  images and paint the group. The colour must be literal or a `:root` variable: the pseudo-elements hang off `<html>`.

  ```css
  ::view-transition-group(.shape) {
    border-radius: 999px;
    background: var(--primary);
  }
  ::view-transition-old(.shape),
  ::view-transition-new(.shape) {
    display: none;
  }
  ```

- **Groups sit on whole pixels**; the live element may not. With a fractional height, the edge jumps 1px when the
  animation hands back. Give animated boxes a whole-pixel height.
- **The RTL overlay.** In an app whose root didn't cross-fade, React shrank `::view-transition` to 0×0, and under
  `dir="rtl"` the UA's `inset: 0` put it a viewport-width off-screen: animated content vanished, then popped in. With
  the root cross-fading, as here, the overlay stays full-size in RTL. If a transition turns the root off and its
  content disappears in Persian only, pin the overlay: `::view-transition { inset: 0 auto auto 0; }`.

## Verifying

A transition can "pass" (state updates, no errors) while drawing nothing or drawing it wrong. Look at frames
**mid-animation** and at the hand-off, in both languages. Playwright is a dev dependency (`@playwright/test`); its
Chromium comes from `pnpm exec playwright install chromium`, which you ask the user before running; put the script in
`.tmp-claude/` (it resolves the repo's packages from there) and run it with `node` against `pnpm dev`. Stop the dev
server afterwards.

**Record and freeze every transition.** Wrap `document.startViewTransition` before the page loads, so you can count
the transitions, see what started them, and pause them to step through:

```js
await page.addInitScript(() => {
  window.__vts = [];
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = (arg) => {
    const vt = start(arg);
    const record = { step: window.__step, scrollAtStart: scrollY };
    window.__vts.push(record);
    vt.ready.then(() => {
      record.scrollAtReady = scrollY;
      if (window.__pause) document.getAnimations().forEach((a) => a.effect.pseudoElement && a.pause());
    });
    vt.finished.then(() => (record.scrollAtEnd = scrollY));
    return vt;
  };
});

// …trigger it, wait for the record, then step through at fixed times:
for (const t of [0, 100, 200, 300]) {
  await page.evaluate((t) => document.getAnimations().forEach((a) => a.effect.pseudoElement && (a.currentTime = t)), t);
  await page.screenshot({ path: `.tmp-claude/frame-${t}.png` });
}
```

A screenshot takes longer than a short animation, so screenshots of a running transition show the end state. Freeze
instead.

**Read where each group goes.** The group keyframes are the boxes the browser captured. A `to` position off-screen,
or different from the live element's final box, is a pop at the end:

```js
document.getAnimations()
  .filter((a) => a.effect.pseudoElement?.startsWith("::view-transition-group"))
  .map((a) => [a.effect.pseudoElement, a.effect.getKeyframes()[0].transform, a.effect.getKeyframes().at(-1).transform]);
```

Check:

1. **No stray transitions**: none on page load (hydration) and none while filling in the form; only the intended
   trigger appears in `__vts`.
2. The mid frames show one clear state at a time (no double exposure) and solid frames; neighbours are between their
   old and new places, not blank.
3. **Both directions** (send and «send another», open and close): stacking and scroll bugs show in one only.
4. The last frame matches the settled page: no box moves, shrinks or crops when the live element takes over, and
   `scrollAtEnd` equals `scrollAtReady`.
5. `/en/...` (LTR) as well as the Persian page, and 390px as well as desktop width.
6. `reducedMotion: "reduce"` in the page options leaves no running `::view-transition*` animations.

Submitting a real form in a check writes rows to the local database; say so when reporting.
