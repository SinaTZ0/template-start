# App Identity: Mood, Tone & Theme

> **Template stub.** Fill in Mood, Tone and the colour values for each project. The type scale, shape, states and
> interaction vocabulary below are what the primitives already implement; change them here and in `app/app.css`
> together. Every value lives in `app/app.css`.

## Mood

_Three to six words, each with one sentence on what it means for the UI._ Example:

- **Calm**: generous whitespace, few colours and gentle shadows.
- **Focused**: one `highlight` call to action per view; everything else is `primary` or neutral.
- **Alive**: subtle, snappy hover and focus feedback on everything you can click, without moving the layout.

## Tone (copy)

- Formal and warm: address the reader as «شما».
- Titles name the thing; buttons use a verb or a noun of intent.
- Persian digits and the Persian thousands separator «٬»; Jalali dates. Phone numbers, e-mail addresses and URLs are
  set `dir="ltr"`.
- _Add the project's own rules: voice, words to avoid, how errors are phrased._

## Theme

Use the Tailwind classes (`bg-primary`, `text-brand-text`, `bg-highlight`…), never raw hex.

### Colour

Token names follow shadcn so the primitives keep working; brand roles get their own names. **Naming trap**: the one
call to action is `highlight`. shadcn's `accent` is the quiet wash for hover and selected states.

The template ships a neutral placeholder palette (grays and a blue `primary`). Replace it per project.

| Token                                 | Use                                                           |
| ------------------------------------- | ------------------------------------------------------------- |
| `background` / `foreground`           | Page background; headings and body text                       |
| `card` / `popover`                    | Cards, forms, header, popovers                                |
| `muted` / `secondary`                 | Recessed bands, input wells, image placeholders               |
| `muted-foreground`                    | Secondary text, dates, captions                               |
| `accent`                              | Hover and selected rows, quiet badges, ghost-button hover     |
| `primary` / `primary-hover`           | Action buttons, active nav marker                             |
| `primary-foreground`                  | Text on `primary`                                             |
| `brand-text`                          | Links and emphasis in text                                    |
| `highlight` / `highlight-hover`       | The one call-to-action fill per view                          |
| `highlight-foreground`                | Text on `highlight`                                           |
| `border`                              | Card outlines and dividers. Not for control edges             |
| `input`                               | Edges of inputs, checkboxes, radios and outline buttons (3:1) |
| `ring`                                | Focus ring                                                    |
| `success` / `success-surface`         | Success notices and badges                                    |
| `warning` / `warning-surface`         | Warnings                                                      |
| `destructive` / `destructive-surface` | Errors and destructive actions                                |
| `info` / `info-surface`               | Informational notices                                         |

Rules:

- **One `highlight` button per view.**
- Status colours always travel with an icon and a word, never colour alone.
- **Dark mode** is the `.dark` class on `<html>` (the theme toggle). Never recolour a component by theme in code; the
  tokens do it.

### Type

- **Font**: Vazirmatn Variable (`@fontsource-variable/vazirmatn`), falling back to Segoe UI and Tahoma.
- **Styles**: use these as `text-<name>` utilities, each setting size, line height and weight.

  | Style     | Size / line height | Weight | Use                              |
  | --------- | ------------------ | ------ | -------------------------------- |
  | `display` | 44 / 68px          | 700    | The hero headline, once per page |
  | `stat`    | 36 / 48px          | 700    | Figures                          |
  | `h1`      | 32 / 52px          | 700    | The page's own title, only       |
  | `h2`      | 24 / 40px          | 600    | Section titles                   |
  | `h3`      | 18 / 30px          | 600    | Card and panel titles            |
  | `h4`      | 15 / 26px          | 600    | List-item titles                 |
  | `body-lg` | 16 / 28px          | 400    | Leads                            |
  | `body`    | 15 / 26px          | 400    | Default running text             |
  | `body-sm` | 13 / 22px          | 400    | Summaries, hints                 |
  | `caption` | 12 / 20px          | 500    | Dates, meta lines, fine print    |
  | `button`  | 13 / 22px          | 600    | Button labels                    |
  | `kicker`  | 12 / 20px          | 600    | The line above a section title   |
  | `nav`     | 13 / 22px          | 500    | Primary navigation               |

- Persian needs tall lines: never tighten line height below the table, and never set text below `caption` (12px).
- Under 600px, `display`, `h1` and `h2` drop one step (set in `app.css`).

### Shape & depth

- **Radius**: `rounded-sm` 8px (inputs, thumbnails, small buttons), `rounded-md` 12px (buttons, notices, tiles),
  `rounded-lg` 18px (feature cards, media), `rounded-full` (badges, chips).
- **Depth**: cards rest on `shadow-sm` plus a 1px `border`; a card that is a link lifts to `shadow-md`.
- **Containers**: use a card only for something you can click or a standalone group of content. Separate items in a
  list with dividers or whitespace, not a box each.
- **Controls**: tap targets at least 40px. Inputs and default buttons are 44px tall; `sm` buttons 40px; `lg` 48px.
- **Layout**: content is at most 1200px wide (`max-w-site`).

### States & motion

- **Focus**: a solid 2px `ring` with a 2px offset. Keyboard focus gets the same feedback as hover
  (`group-focus-visible` next to every `group-hover`), plus the ring.
- **Hover** lightens or tints by one step. **Disabled** controls drop to 45% opacity and get no hover effects.

#### Interaction

Feedback starts at once and settles fast; it never bounces or moves the layout. `ease-out` for everything.

| What changes                                | Duration |
| ------------------------------------------- | -------- |
| Colour, background, border, text, icon fill | 150ms    |
| Small transforms: arrow nudge, press        | 150ms    |
| Card shadow and wash                        | 200ms    |
| Media zoom inside a card                    | 300ms    |

Animate only `color`, `background-color`, `border-color`, `box-shadow`, `opacity` and `transform`, and list the
properties (never `transition-all`).

| Effect          | Where                                       | How                                                             |
| --------------- | ------------------------------------------- | --------------------------------------------------------------- |
| **Card lift**   | Whole-card links                            | `shadow-sm` → `shadow-md` and a faint `accent` wash, 200ms      |
| **Media zoom**  | The photo inside a card link                | `group-hover:scale-[1.03]` in an `overflow-hidden` frame, 300ms |
| **Title tint**  | Card titles inside a link                   | `group-hover:text-brand-text`, 150ms                            |
| **Arrow nudge** | The trailing `arrow-left` of links, buttons | `group-hover:-translate-x-1` (4px forward in RTL), 150ms        |
| **Press**       | Buttons                                     | `active:translate-y-px`                                         |
| **Link tint**   | Plain text links                            | `brand-text` → `foreground`                                     |

These effects belong to primitives and shared components, so routes get them by composing, not by repeating classes.

**Reduced motion**: apply transforms with `motion-safe:` and drop colour transitions with
`motion-reduce:transition-none`; the end states still apply instantly.

### Iconography & imagery

- **Icons**: Lucide outline icons with a 1.5 stroke (set in `app.css`; don't pass `strokeWidth`). No emoji.
- **Direction**: forward actions use `arrow-left` (RTL).
- _Describe the project's photography and logo here._

## Accessibility

- Text pairs at least 4.5:1; control edges, focus rings and large text at least 3:1. Check new colours in both themes.
- Every page declares `lang="fa"` and `dir="rtl"`, and marks any English span with `lang="en"`.
- Use logical properties only (`ms`/`me`, `ps`/`pe`, `start`/`end`), never left/right.
