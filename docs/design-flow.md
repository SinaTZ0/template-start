# Design Flow

Follow these steps for every new page. Going back to an earlier step is fine when the design changes.

1. **Purpose**: In one sentence, say what the user comes to this page to do. Example: "See my notes and add a new one."
2. **App context**: Read [app-identity.md](./app-identity.md). Note how this page's copy follows the tone rules. Don't create a new mood, tone or theme for one page.
3. **Content inventory**: before choosing any layout, list what the page really shows, using the real content (the route's `content.ts` or the API data), not placeholder text:
   - each image: a photo or an image that contains text (poster, flyer, certificate), and its aspect ratio;
   - how many items each section has, and how long the titles and summaries run;
   - which content is time-sensitive (announcements, deadlines) and which is evergreen.

   The inventory decides the layout: posters never get text laid over them, three items don't get a layout built for six, and a short list shares a band with something else instead of filling one alone.

4. **Page brief**: this is where the page is designed.
   - `role`: where the page sits in the flow (entry, list, detail, form, settings…) and where the user goes next.
   - `structure`: the sections from top to bottom, with what each one contains. Include the empty, loading and error states.
   - `design`: the layout and visual hierarchy, i.e. what the eye should land on first, second and third, and how the layout adapts from phone to desktop. Include one distinctive idea that serves the page's purpose and makes it memorable, not just a generic template.
   - `look`: density, emphasis and how colour is used on this page, within the app theme. Name what makes it feel content-led: where photos show clearly and which containers you left out.
   - `interaction`: which effects from app-identity's interaction vocabulary each clickable thing gets (card lift, media zoom, arrow nudge…).
5. **Components**: the brief decides the design; components serve it. Never let the component list flatten the design.
   - **Standard controls** (buttons, inputs, dialogs, menus…): pick the shadcn component that fits ([shadcn.md](./shadcn.md)) and use its primitive from `components/primitive/`.
   - **App components** (form alerts, links…): check `components/shared/` before building something new.
   - **Custom pieces**: build anything more distinctive in the route slice, composing primitives where they fit.
   - **No decorative containers**: add a card, tile or panel only for something you can click or a standalone group of content. Whitespace and dividers separate everything else. Items that share a container fill it edge to edge ([app-identity.md](./app-identity.md) → Containers).
6. **Prepare shared pieces**: as a separate change before the page, create any missing primitive and update any whose base style doesn't match app-identity yet ([components.md](./components.md)), including its interaction effects. Base styles follow app-identity, never one page's needs, because a change affects every page. Update the story and check it in light, dark and side by side (`pnpm storybook`).
7. **Build**:
   - A page-specific look that will be reused becomes a variant. One-off creative styling is fine; keep it local to the page.
   - Move a custom piece to `components/shared/` once a second route needs it.
   - The app is right-to-left. Use logical utilities (`ms`/`me`, `ps`/`pe`, `start`/`end`, `text-start`), never `left`/`right`.
8. **Review**: compare the page with the brief: the hierarchy, the distinctive idea, and every state. Check it at phone and desktop widths, in light and dark, and against `WCAG 2.2 AA`. Then check a full-page screenshot: photos clearly visible, no text over posters, no boxes that do nothing, no band that looks empty. Hover and tab through every clickable thing: each one responds, nothing moves the layout, and reduced motion turns the movement off.
