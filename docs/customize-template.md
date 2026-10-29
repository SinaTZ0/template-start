# Customizing the Template from a Homepage Design

Use this once, when a new project starts from the template. The person gives you a finished homepage design, and you
turn it into the project's design system: app-identity, tokens, primitives, header and footer, and the home route. After
this, new pages follow [frontend-flow.md](./frontend-flow.md).

**The homepage is the source of truth for the look.** Wherever the template's current tokens, type styles, variants or
layouts disagree with it, the template changes. The template's code structure stays: route slices, primitives built
on `ui/`, `defineStyles`, tokens in `src/styles.css` ([architecture.md](./frontend/architecture.md),
[components.md](./frontend/components.md)). The one exception is the constraints in
[app-identity.md](./frontend/app-identity.md#constraints) (contrast, keyboard focus, text size, RTL). If the homepage
breaks one, tell the person and propose the smallest change that fixes it, rather than silently restyling.

## Input

- **The homepage source** (HTML, JSX, CSS) at the path the person gives. It holds the exact values: colours, sizes,
  spacing, radii, shadows, fonts.
- **Screenshots**, if any. They show the intent where the source is unclear. If the source and a screenshot disagree,
  ask.

Move the source and screenshots to `docs/frontend/reference/` so later work can compare against them. It is reference
material, like `components/ui/`: never import from it.

The homepage usually leaves things out. Design these in its language and list them for the person at the end:

- a phone layout, if the design is desktop-only;
- a dark theme, if it has none;
- states it doesn't show: hover, keyboard focus, disabled, loading, empty, errors;
- form controls and anything else the other pages need (sign-in, notes).

## 1. Read the Design

Before editing anything, make an inventory from the source:

- **Colours**, grouped by the role each plays: page and section backgrounds, text levels, links, buttons and their
  hovers, borders, badges, status colours. Include the surfaces that break the page's main scheme, such as a dark band
  on a light page, and the text, borders and buttons that sit on them.
- **Type**: the font families, and each distinct text style (size, line height, weight) with where it's used.
- **Shape and depth**: radii, border widths, shadows, and what each is used on.
- **Layout**: content width, section spacing, grids and gutters.
- **Recurring pieces**: buttons, links, cards, badges, tabs, list rows, section headings, and how many visual variants
  of each there are.
- **Motion**: hover and focus effects and their durations.
- **Imagery**: photos, posters with text in them, overlays and gradients, aspect ratios.
- **Header and footer**: their structure and what each part does.

## 2. App Identity

Fill in [app-identity.md](./frontend/app-identity.md) and delete its stub note:

- **Mood**: from what the page emphasises and how it feels, each word tied to something visible in the design.
- **Tone**: from the homepage's copy. Keep the Persian rules already there, and say how English (or the project's
  other languages) carries the same tone.
- **Brand**: the logo, how imagery is treated, and **References** pointing at `docs/frontend/reference/`.

## 3. Tokens in `src/styles.css`

- **Colours**: map each colour role to a token. Keep every token name the primitives use (shadcn's names plus
  `highlight`, `brand-text` and the status pairs), so components keep working. Mind the trap: `highlight` is the
  call-to-action fill and `accent` is the quiet hover wash. When the design has a role no token covers, such as a dark
  brand band and the text and borders on it, add tokens for it (a `--<name>` value in both themes, mapped to
  `--color-<name>` in `@theme` like the existing ones) instead of reusing `primary` or `foreground` as a surface.
- **Dark theme**: if the homepage has none, derive one from the same hues. Bands that are already dark may stay close
  to their light-theme values.
- **Type styles**: replace the `--text-*` styles with the homepage's set. Rename, add or remove styles to match it, and
  update every usage (search for `text-<name>`) and the type-style list in `cn` (`src/lib/utils.ts`). Keep Persian
  line heights generous and text at 12px or larger.
- **Font**: if the homepage uses another font, self-host it with an `@fontsource` package or files in `public/`
  instead of an external font service, and update `--font-sans` in `styles.css`.
- **Shape and layout**: radii, shadows (`--elevation-*`) and the content width (`--container-site`, used as `max-w-site`).
- Check contrast for every text and control pair in both themes.

## 4. Primitives

- Restyle each primitive in `src/components/primitive/` to match its counterpart on the homepage: base styles first,
  then a variant for each distinct look that recurs. Remove template variants that nothing uses anymore.
- When the homepage uses a component that has no primitive yet (tabs, accordion, navigation menu…), create one from
  `ui/` ([components.md](./frontend/components.md#creating-a-primitive)).
- Keep shadcn's API and `data-slot`s. Update each story and check it in light and dark (`pnpm storybook`).

## 5. Header, Footer and Shared Pieces

- Rebuild `site-header` and `site-footer` in `src/components/shared/` from the homepage, keeping their current behavior
  (navigation, theme toggle, sign-in and sign-out).
- Promote a homepage piece to `shared/` only if other pages will clearly use it (a section heading, a link row).
  Sections that only the homepage has stay in the home slice.

## 6. The Home Route

- Rebuild the homepage in `src/routes/home/` from primitives, tokens and slice components. Don't paste the reference
  markup: it would bring raw colours, arbitrary values and physical directions back in, which `pnpm lint` rejects.
- Its copy goes into `messages/fa.json` as written, and into the other locale files translated
  ([i18n.md](./frontend/i18n.md)). Static content data that only the homepage shows can stay in the slice until a
  procedure serves it, but its text still comes from messages.
- Until the features behind its content exist (news, events…), keep that content as static data in the slice, in its
  own file with a comment saying which future procedure replaces it.
- Images go in `public/` for now; uploads come later through [media.md](./backend/media.md).

## 7. The Rest of the Template

- Restyle the sign-in page (`src/routes/auth/`) and the notes pages so they belong to the new design.
- Replace `public/favicon.ico`, and return a 1200×630 preview image in the new style from `siteImage()` in
  `src/lib/site.ts`, with its `alt` a message.
- Set `site_name` and `site_description` in every locale file to the project's name and description.
- Ask which languages the project needs. The template ships Persian and English; follow
  [i18n.md](./frontend/i18n.md) → Adding or Removing a Language for anything else.

## 8. Check

- Compare the home route with the reference side by side, at desktop and phone widths.
- Check both themes and both directions (`/` and `/en`), tab through every clickable thing, and turn on reduced motion.
- Run `pnpm lint`, `pnpm typecheck` and `pnpm build`.
- Report what you designed that the homepage didn't show (see Input), and any constraint the homepage broke.
