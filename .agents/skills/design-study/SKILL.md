---
name: design-study
description: How this project compares design directions before building one. Use whenever the user asks for an "EXAMPLE STUDY" ("give me 4 EXAMPLE STUDY", "a study for the footer"), for several designs or options for a part of the site ("give me 4 different designs for X", "like you did with the hero"), for more options in a running study ("give me four more"), or for versions of one option ("give me three other versions of option 2"). Produces a standalone comparison page in .tmp-claude/<topic>-study/ built from the live site's real content, with the current design as option 0, toggles for device, language and theme, notes per option and checked screenshots, then builds only the option the user picks. Never builds variants inside the app and never publishes to claude.ai.
---

# Design Study

A design study answers "what should this part of the site look like?" by putting the current design next to a few
real alternatives the user can flip through, before any of them touches `src/`. Each study ends in a single build of
the chosen option. Earlier studies stay in `.tmp-claude/*-study/`; read the latest one, when there is one, for a full
example.

## Hard rules

- **Local only.** The study is a standalone HTML file in `.tmp-claude/<topic>-study/`, opened in the user's own
  browser. Never use the Artifact tool or Claude Docs for it, never open anything on claude.ai.
- **Never in the app.** Don't build options behind a switch, flag, cookie or preview widget in `src/`. A variant
  switch spreads into primitives, props and CSS, and every later change has to be made once per variant.
- **Nothing in `src/` until the user picks.** No commit until the user says so.
- **Real content.** Use the live page's real text, photos and data, Persian first. Placeholder text hides the very
  problems the study is for (long Persian titles, banners with text to their edges, landscape photos).

## 1. Find the actual problem

Before drawing anything, look at the current design and work out what is wrong with it. Write it down in one or two
sentences; it becomes the study's subtitle and the first thing in your reply.

- Screenshot the current design (it becomes option 0). Copy `scripts/shoot-base.mjs` into the study folder and set
  its pages, sections and output names. It shoots desktop (1440) and phone (390) × fa/en × light/dark with the site's
  header hidden.
- Measure what you can: the photos' real shapes (`identify`, or `naturalWidth` in Playwright), title lengths, how
  many items a list has. A card design can look fine on paper and fail because every real photo is landscape while
  its frames are tall or square.
- Save the content the options will use: the procedure output (`curl -X POST localhost:3000/rpc/<feature>/<proc>
  -d '{}'`) as JSON, and the images in `assets/`. Copy the fonts from the app (`public/` or `node_modules`) into
  `assets/` so the page renders with Vazirmatn.
- Read `docs/frontend/app-identity.md` and look at the site's most finished parts (the homepage, the header): options
  should feel like this site, its colours, type and motifs, not like a generic template.

## 2. Choose the options

The default is **four** options, numbered 1–4 after the current design (0). They must differ in **concept**, not in
colour or radius. Good studies have spread across:

- the safe fix: the smallest change that solves the problem, and that looks like the rest of the site;
- one that leans hardest into the site's identity (its signature colours, motifs and drawings);
- one that changes the structure (a list instead of cards, a rail, an index with a preview, a band);
- one that is bold or photo-led, with its risk named honestly.

For each option write: a name of one to three words, a one-line tag, a short lead paragraph saying what it is and
why, and three lists: **Good**, **Watch** (real risks: hidden content, text covered, dark mode, phone length) and
**Build** (what it would cost in this codebase: which components, primitives, tokens, and any backend change such as
a new image size).

## 3. Build the comparison page

Copy `assets/viewer.html` to `.tmp-claude/<topic>-study/index.html` and fill in its marked parts. It already has:

- the notes panel at the top, above the option buttons, so the reader knows what an option is (its lead, **Good**,
  **Watch** and **Build**) before comparing it; keep it there;
- the option buttons (keys 0–9), a row of version pills for an option's versions (keys a–d), and the toggles: device
  (desk 1440 / phone 390), language (fa rtl / en ltr), theme (light / dark), plus any toggles the topic needs
  (section, state such as "scrolled" or "menu open");
- the state saved in `localStorage`, so a reload keeps the view;
- a desktop frame that zooms to fit the window, and a phone frame at 390;
- option 0 drawn from the baseline screenshots in `base/`.

Rules for the mock itself:

- Copy the tokens from `src/styles.css` (light and dark) into the page's `:root` and `:root.dark`. Don't invent
  colours; add a new token only when the option needs one, and say so under **Build**.
- Mock the page's surroundings too (the section head, the panel beside it), so each option is judged in place.
- Use container queries on the mock (`.site { container: site / inline-size }`) for phone layouts, not media
  queries: the phone frame is 390 wide inside a wide window.
- Use logical properties (`inset-inline-start`, `margin-inline`, `border-inline-start`) so both directions work, and
  `dir="auto"` on text that comes from content.
- Labels that only help the comparison (a photo's measured ratio, say) are allowed but must be called study-only.
- When colour tells kinds apart (dates in a calendar, series, statuses), pick the hues with the `dataviz` skill's
  validator, not by eye (all pairs when every kind can be on screen at once, in both modes), check each ink's
  contrast on its tint, and give every kind a second cue (a shape, a label), so colour is never the only one.

## 4. Check it before handing over

Shoot every option with `scripts/shoot-study.mjs` (copy it into the study folder). Look at every image yourself. At
the least, check every option on desktop fa light and phone fa light, and the new ones on en dark. Fix what you find:
overflow, text over a banner's text, uneven columns, a rule running past its column, a dark-mode surface that
disappears. Report anything you could not fix.

## 5. Hand over

Reply in a few short paragraphs:

1. the absolute path of `index.html` to open, and which keys and toggles to use;
2. the problem, in one or two sentences;
3. one short paragraph per option: what it is, what's good, what to watch;
4. your honest pick and why, and the safe alternative if it differs; ask which one to build.

Record the study in memory: the topic, the options and that the pick is pending.

## Follow-ups

- **"Give me four more"**: add options 5–8 to the same page, tagged `fresh: true` (the page shows "new" on them), with
  the same notes, checks and reply. Recommend across all of them, not only the new ones.
- **"Give me N other versions of option K"**: add them as versions of K (`parent: K`, `num: "Kb"`, "Kc", …). The
  page then shows the pills under the options while K is picked, and keys a–d switch versions. Variations should
  still differ in idea within K's family (a front page, a ruled list, a chronicle), not only in spacing.
- **"Mix 3 with the band from 8"**: make it a version of the closer option, and say what it borrows.

## Building the pick

Once the user picks, build only that option in `src/`, following `docs/frontend-flow.md`:

- Change the primitives and `src/styles.css` where the design needs it (a variant, a token) instead of bending the
  design to fit them, and add or update the primitive's story.
- Delete what the old design leaves unused: components, message keys in both `messages/*.json`, tokens.
- Run `pnpm lint`, and `pnpm typecheck` when props or contracts changed.
- Screenshot the real page with section-level locator screenshots (`section[aria-labelledby=…]`), waiting for
  hydration. Don't resize the viewport to fit a long page: anything sized by the viewport (a hero) grows with it. A
  sticky header shows over the top of an element screenshot; that's expected.
- Commit and push only when the user says so. commitlint caps body lines at 100 characters.
- Update the study's memory note with the outcome and the commit.

## Pitfalls

- Some sites answer `HeadlessChrome` with an error; pass a normal Chrome user agent (`shoot-base.mjs` does).
- When clipping a screenshot from `boundingBox()`, add `scrollY` to `y` and pass `fullPage: true`.
- Don't put a photo's text under an overlay: banners often carry text to their edges.
- Content that isn't translated (Persian titles on the English page) needs `dir="auto"` in the mock so it reads in its
  own direction.
