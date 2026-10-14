# Frontend Flow

Start here for any frontend work. Follow the steps in order for every new page; going back to an earlier step is fine
when the design changes. Each step links to the doc that holds its rules. Read that doc when you reach the step.

Changing only a primitive or a shared component? Go straight to step 6.

| Doc                                                            | Covers                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| [frontend/architecture.md](./frontend/architecture.md)         | Structure, route slices, data, state, navigation, forms, RTL, styling |
| [frontend/app-identity.md](./frontend/app-identity.md)         | Mood, tone, theme, interaction vocabulary, accessibility              |
| [frontend/components.md](./frontend/components.md)             | Primitives, shared components, style maps                             |
| [frontend/shadcn.md](./frontend/shadcn.md)                     | The shadcn component catalogue                                        |
| [frontend/nuqs.md](./frontend/nuqs.md)                         | URL state                                                             |
| [frontend/jotai.md](./frontend/jotai.md)                       | Shared client state                                                   |
| [frontend/view-transitions.md](./frontend/view-transitions.md) | The page fade                                                         |
| [backend/media.md](./backend/media.md)                         | Uploading and rendering images                                        |

The `notes` route (`app/routes/notes/`) is the worked example.

## Design

1. **Purpose**: In one sentence, say what the user comes to this page to do. Example: "See my notes and add a new one."
2. **App context**: Read [app-identity.md](./frontend/app-identity.md). Note how this page's copy follows the tone
   rules. Don't create a new mood, tone or theme for one page.
3. **Content inventory**: before choosing any layout, list what the page really shows, using the real content (the
   page's own copy or the API data), not placeholder text:
   - each image: a photo or an image that contains text (poster, flyer, certificate), and its aspect ratio;
   - how many items each section has, and how long the titles and summaries run;
   - which content is time-sensitive (announcements, deadlines) and which is evergreen.

   The inventory decides the layout: posters never get text laid over them, three items don't get a layout built for
   six, and a short list shares a band with something else instead of filling one alone.

4. **Page brief**: this is where the page is designed.
   - `role`: where the page sits in the flow (entry, list, detail, form, settings…) and where the user goes next.
   - `structure`: the sections from top to bottom, with what each one contains. Include the empty, loading and error
     states.
   - `design`: the layout and visual hierarchy, i.e. what the eye should land on first, second and third, and how the
     layout adapts from phone to desktop. Include one distinctive idea that serves the page's purpose and makes it
     memorable, not just a generic template.
   - `look`: density, emphasis and how colour is used on this page, within the app theme. Name what makes it feel
     content-led: where photos show clearly and which containers you left out.
   - `interaction`: which effects from app-identity's interaction vocabulary each clickable thing gets (card lift,
     media zoom, arrow nudge…).
5. **Components**: the brief decides the design; components serve it. Never let the component list flatten the design.
   - **Standard controls** (buttons, inputs, dialogs, menus…): pick the shadcn component that fits
     ([shadcn.md](./frontend/shadcn.md)) and use its primitive from `components/primitive/`.
   - **App components** (form alerts, links…): check `components/shared/` before building something new.
   - **Custom pieces**: build anything more distinctive in the route slice, composing primitives where they fit.
   - **No decorative containers**: add a card, tile or panel only for something you can click or a standalone group of
     content. Whitespace and dividers separate everything else. Items that share a container fill it edge to edge
     ([app-identity.md](./frontend/app-identity.md) → Shape & depth).

## Build

6. **Prepare shared pieces**: as a separate change before the page, create any missing primitive and update any whose
   base style doesn't match app-identity yet ([components.md](./frontend/components.md)), including its interaction
   effects. Base styles follow app-identity, never one page's needs, because a change affects every page. Update the
   story and check it in light, dark and side by side (`pnpm storybook`).
7. **Route and data**: register the route in `routes.ts` and create its flat slice folder
   ([architecture.md](./frontend/architecture.md) → Route Slices). Guard it with `requireSession` on a layout route if
   it needs a signed-in user. Load render-critical data in the `loader` through `createServerClient(request)`; add
   `meta` and an `ErrorBoundary` where needed ([architecture.md](./frontend/architecture.md) → Data and the Server
   Boundary).
   - The page's data comes from oRPC procedures. If one it needs doesn't exist yet, add it first with
     [backend-flow.md](./backend-flow.md).
   - Shareable view state (filters, tabs, pagination) goes in the URL through [nuqs](./frontend/nuqs.md); client state
     shared across distant parts of the tree goes in [Jotai](./frontend/jotai.md).
8. **UI**: build it from primitives, shared components and slice-private ones, following the brief.
   - A page-specific look that will be reused becomes a variant. One-off creative styling is fine; keep it local to
     the page.
   - The app is right-to-left. Use logical utilities (`ms`/`me`, `ps`/`pe`, `start`/`end`, `text-start`), never
     `left`/`right`.
   - Build every state from the brief: loading, empty, error and success.
9. **Forms**: add the form's `schema.ts`, submit with `useMutation(orpc.<feature>.<procedure>.mutationOptions())`,
   show the server's errors through `describeApiFailure`, and revalidate the loader on success
   ([architecture.md](./frontend/architecture.md) → Forms). Image fields follow [media.md](./backend/media.md).
10. **Promote**: move a custom piece to `components/shared/` (or a hook to `app/hooks/`) once a second route needs it.

## Check

11. **Review**: compare the page with the brief: the hierarchy, the distinctive idea, and every state. Check it at phone
    and desktop widths, in light and dark, and against `WCAG 2.2 AA`. Then check a full-page screenshot: photos
    clearly visible, no text over posters, no boxes that do nothing, no band that looks empty. Hover and tab through
    every clickable thing: each one responds, nothing moves the layout, and reduced motion turns the movement off.
12. **Test**: add a Playwright smoke test if the flow is consequential (forms, critical navigation). Run `pnpm lint`.
