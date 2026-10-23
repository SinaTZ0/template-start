# App Identity: Mood, Tone & Theme

> **Template stub: delete this note once the project fills in Mood, Tone and Brand.** Until then, nothing here or in
> the code is a design decision. The theme values (colours, type styles, radius, shadows) live in `src/styles.css` and the
> primitives' `*.styles.ts`; what ships there is a neutral placeholder. When the project's design calls for something
> different, change `styles.css` and the primitives, and keep Mood, Tone and Brand here in step with them.

## Mood

_Three to six words, each with one sentence on what it means for the UI._ Example:

- **Calm**: generous whitespace, few colours and gentle shadows.
- **Focused**: one clear call to action per view.

## Tone (copy)

Persian is the reference copy; every other language carries the same tone in its own idiom, not a word-for-word
translation ([i18n.md](./i18n.md)).

- Formal and warm: address the reader as «شما» (in English: plain, polite, second person).
- Persian digits and the Persian thousands separator «٬»; Jalali dates. These come from the locale through the
  formatting helpers, never typed into a message. Phone numbers, e-mail addresses and URLs are set `dir="ltr"` in
  every language.
- _Add the project's own rules: voice, words to avoid, how errors are phrased._

## Brand

_The logo and how it's used, the photography or illustration style, and anything the brand rules out._

- **References**: _the design the project's look comes from, e.g. the reference homepage
  (`docs/frontend/reference/`), plus any sites or screenshots whose feel to aim for._

## Theme

- Use the theme's Tailwind classes (`bg-primary`, `text-muted-foreground`, `text-h2`…), never raw hex or the Tailwind
  palette. A new colour or type style is declared in `src/styles.css` first.
- Token names follow shadcn so the primitives keep working. **Naming trap**: the brand call-to-action fill is
  `highlight`; shadcn's `accent` is the quiet wash for hover and selected states.
- **Dark mode** is the `.dark` class on `<html>` (the theme toggle). Recolour through the tokens, never by theme in
  component code.
- Icons are Lucide. Their stroke width is set in `styles.css`; change it with a `stroke-*` class, not the `strokeWidth`
  prop.

## Constraints

These come from the language and accessibility, not from taste, so they hold whatever the design:

- Persian needs tall lines: keep line heights generous and text at 12px or larger. The same type styles serve
  English.
- Both directions: the layout mirrors between Persian (right-to-left) and English (left-to-right), and
  forward-pointing icons point the way the text reads. The code rules are in
  [architecture.md](./architecture.md#language-direction-and-accessibility) and [i18n.md](./i18n.md).
- Text pairs at least 4.5:1; control edges, focus rings and large text at least 3:1. Check new colours in both themes.
- Every interactive element shows a visible keyboard focus. Status colours travel with an icon or a word, never colour
  alone. Movement respects `prefers-reduced-motion` (`motion-safe:` / `motion-reduce:`).
- Tap targets are at least 40px.
