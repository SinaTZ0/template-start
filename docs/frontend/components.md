# Component Conventions

## Where Components Live

- `app/components/primitive/` holds this app's versions of shadcn components. Every shadcn component the app uses lives here, restyled or not, so all of them manage their classes with `defineStyles`. Each one owns its folder:

  ```text
  primitive/button/
    button.tsx          # rendering and props
    button.styles.ts    # style groups and CVA variants
    button.stories.tsx  # maintained UI documentation
  ```

- `app/components/ui/` holds the untouched shadcn source, with every component installed. It is reference material only: never edit it and never import from it. Read it only when creating a primitive.
- `app/components/shared/` holds app-made components used by more than one route: things with no shadcn original, such as `form-alert`, `site-link`, `media-image` and `theme-toggle`. They use the same one-folder-per-component layout, with a `<name>.styles.ts` only when the component has its own style map, and a story for anything visible. The shadcn API rule below doesn't apply to them; they compose primitives instead.
- Route-specific pieces stay in their route slice and move to `shared/` when a second route needs them; see [architecture.md](./architecture.md).

Import directly from the owning file. `buttonVariants` and other CVA helpers come from the `*.styles.ts` file.

## Creating a Primitive

Build the primitive from the shadcn source in `ui/` instead of writing it from memory:

1. Copy the `ui/` file into `primitive/<name>/<name>.tsx`. Leave the `ui/` file as it is.
2. Move its classes into `<name>.styles.ts` as `defineStyles` groups (see below). Keep the shadcn classes as they are unless the component needs restyling for app-identity.
3. Keep shadcn's API: the same exports, props, parts and `data-slot` / `data-*` attributes, so shadcn's docs and patterns still apply. Customise styles and add variants, but don't rename or restructure.
4. If it composes other shadcn components, import their primitives, creating them first if they don't exist.
5. Add `<name>.stories.tsx`.

## Editing Styles

Wrap style maps in `defineStyles` from `primitive/styles.ts`. It keeps the classes split into named groups, keeps their keys typed for CVA, and lets Prettier sort the Tailwind classes inside it. It does no merging at runtime.

```ts
const twVariant = defineStyles({
  default: {
    appearance: "bg-primary text-primary-foreground",
    hover: "hover:bg-primary/80",
  },
});
```

Use the same group names across components and leave out the ones you don't need. Unknown names fail type-checking.

| Group                      | Contents                                                   |
| -------------------------- | ---------------------------------------------------------- |
| `layout`                   | Display, alignment, positioning, gaps, and `group/*` names |
| `geometry`                 | Dimensions, padding, margin, radius, and border width      |
| `typography`               | Font family, size, weight, alignment, and line height      |
| `appearance`               | Colors, border colors, shadows, and placeholder colors     |
| `interaction`              | Transitions, cursor, selection, and pointer behavior       |
| `hover`, `focus`, `active` | Styles belonging to each interaction state                 |
| `disabled`, `invalid`      | Disabled and `aria-invalid` styles                         |
| `state`                    | Open/closed, expanded, and enter/exit styles               |
| `motion`                   | Reduced-motion overrides                                   |
| `icon`                     | Selectors affecting descendant icons                       |

Interactive primitives own their hover, focus and press feedback, taken from the interaction vocabulary in [app-identity.md](./app-identity.md#interaction), along with its timings and reduced-motion overrides. Put transitions in `interaction`, the end states in `hover` / `focus` / `active`, and `motion-reduce:` classes in `motion`. Effects on a child (media zoom, arrow nudge, title tint) hang off a named group on the root (`group/card`, `group/link`) and pair every `group-hover/*` with `group-focus-visible/*`.

When one group has a distinct sub-concern, add a capitalized suffix and a comment saying why, e.g. `geometryIcon` for padding that adjusts around a `data-icon` child, or `stateAutofill`.

Helpers:

- `joinStyles(groups)` turns one set of groups into a class string, both for a part without variants and for a CVA base.
- `composeStyles(map)` turns a map of variant options into CVA's `variants` and keeps the option keys literal.
- Resolve Tailwind conflicts only at the element: `cn(componentVariants({ variant, size }), className)`. Preserve Base UI's function `className` where a wrapper supports it, as Button does.

Export the variant maps as `twVariant`, `twSize`, and so on, so stories can build their controls from them (`Object.keys(twVariant)`). That way a new variant appears in Storybook without touching the story. Consumers use the component's props; they never import or mutate the maps.

Prefer a CVA variant over `data-[size=…]:` selectors on the element itself. Keep the `data-*` attribute as well when a child or a parent reads it, as CardTitle does with `group-data-[size=sm]/card`.

## Lint Rules

`pnpm lint` runs [`@shadcn/lint`](https://github.com/shadcn-ui/lint) (configured in `.oxlintrc.json`) to enforce the boundary above:

- `no-restyle`: outside `primitive/`, a primitive's `className` may only hold layout (margin, width, flex and grid placement). Anything else, such as padding, color, radius or font, belongs in a variant.
- `no-raw-colors`: use theme colors from `app/app.css`, not the Tailwind palette (`bg-pink-500`). A new color is declared there as `--color-<name>` first.
- `no-arbitrary-values`: stay on the scale (`w-88`, not `w-[22rem]`). A layout the scale can't express usually reads better as flex or grid with scale widths.
- `no-inline-styles`: put dynamic values in a CSS custom property and read them from a class, as `media-image` does: `style={{ "--placeholder": url }}` with `bg-(image:--placeholder)`.

The linter can't read `defineStyles` maps, so the color and arbitrary-value rules don't cover `*.styles.ts` files. Keep primitive styles on theme tokens by hand.

### Fixing a Lint Error

Work through these in order and stop at the first that fits:

1. Use an existing variant or size prop on the primitive.
2. If the class is about placement, move it to the parent (`gap`, grid or flex) or keep only its layout part.
3. If the design really needs a new look, add or change a variant in the primitive's `*.styles.ts`, following [Changing a Primitive](#changing-a-primitive): check its consumers and update the story. A variant should be a look the design can reuse, not a fix for one page.

Don't silence the error with a disable comment, a wrapper element that carries the styling, or a raw element in place of the primitive. If a rule is genuinely wrong somewhere, disable it on that line with a comment saying why.

## Changing a Primitive

A primitive's styles change every page that uses it, so follow the "Prepare shared pieces" step in [frontend-flow.md](../frontend-flow.md). Before you change a default or add a variant, check the existing consumers and the other primitives that compose it, because some rely on its slots and selectors (`data-slot`, `in-data-[slot=button-group]`, `has-data-[icon=…]`, `aria-invalid`). Then update the story.

## Whole-Card Links

A card that is a link renders as that link: `<Card render={<SiteLink href="…" />}>`. Don't wrap a card in a link or hand-write focus classes around it. The card then gets the card lift and focus ring, and its `CardTitle`, `CardMedia` and any `TextLink` call without `href` react to its hover and keyboard focus (they key off `[a:hover_&]`, so plain cards stay still). Put the image in `CardMedia`, with `fit="top"` or `fit="contain"` for posters.
