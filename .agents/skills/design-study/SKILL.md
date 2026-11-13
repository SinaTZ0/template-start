---
name: design-study
description: How this project compares design directions before building one. Use whenever the user asks for an "EXAMPLE STUDY" ("give me 4 EXAMPLE STUDY", "a study for the footer"), for several designs or options for a part of the site ("give me 4 different designs for X", "like you did with the hero"), for more options in a running study ("give me four more"), or for versions of one option ("give me three other versions of option 2"). Produces a gitignored study route at /design-study/<topic> built from the real components and live data, Persian first, with the current design as option 0, a study bar with notes per option and checked screenshots on desktop and phone, then builds only the option the user picks and removes the study's files, keeping its screenshots. Never changes the app for a study and never publishes to claude.ai.
---

# Design Study

A design study answers "what should this part of the site look like?" by putting the current design next to a few real
alternatives the user can flip through, before any of them touches the app. Each study ends in a single build of the
chosen option. A study is a gitignored route: real components, real data, real popups and carousels, opened at
`/design-study/<topic>`. Screenshots of earlier studies stay in `.tmp-claude/*-study/shots/`.

## Hard rules

- **Gitignored route only.** A study lives in `src/routes/design_study/<topic>/`. `src/routes.ts` finds it on disk and
  never mounts it in a production build; `.gitignore` and `.dockerignore` keep it out of the repo and off the server. It
  exists only on this machine.
- **The app never imports from a study.** A study may import anything from the app; nothing in the app may know about it.
  No switch, flag, cookie or preview widget in tracked code: a variant switch spreads into primitives, props and CSS, and
  every later change has to be made once per variant.
- **No tracked file changes until the user picks.** A variant or token an option needs stays in the study folder (a
  `className`, a local component). Study-only words stay there too, never in `messages/*.json`: a tracked key would outlive
  the study. Real messages are fine to read with `m.*`.
- **Local only.** Never use the Artifact tool or Claude Docs for a study, never open anything on claude.ai. Outside
  reviewers get the screenshots.
- **Real content.** Use the live page's real data, Persian first. Placeholder text hides the very problems the study is for
  (long Persian titles, banners with text to their edges, landscape photos).
- **No commit** until the user says so.

A page that doesn't exist yet, or an option that needs a library the app doesn't have, can't be a route. That one gets a
standalone HTML mockup in `.tmp-claude/<topic>/`.

## 1. Find the actual problem

Before drawing anything, look at the current design and work out what is wrong with it. Write it down in one or two
sentences; it becomes the first thing in your reply.

- Screenshot it on desktop (1440) and phone (390), and measure what you can in Playwright: heights, where the content
  starts, edges that should line up, title lengths, how many items a list has, the photos' real shapes (`naturalWidth`,
  or `identify` on a download). A number beats an impression. A card design can look fine on paper and fail because every
  real photo is landscape while its frames are tall or square.
- Read `docs/frontend/app-identity.md` and look at the site's most finished parts (the homepage, the header): options
  should feel like this site, its colours, type and motifs, not like a generic template.

## 2. Choose the options

The default is **four** options, numbered 1–4 after the current design (0). They must differ in **concept**, not in colour
or radius. Good studies have spread across:

- the safe fix: the smallest change that solves the problem, and that looks like the rest of the site;
- one that leans hardest into the site's identity (its signature colours, motifs and drawings);
- one that changes the structure (a list instead of cards, a rail, an index with a preview, a band);
- one that is bold or photo-led, with its risk named honestly.

For each option write: a name of one to three words, a lead saying what it is and why, and three lists: **Good**,
**Watch** (real risks: hidden content, text covered, dark mode, phone length, a long Persian title) and **Build** (what it
would cost in this codebase: which components, primitives and tokens, and any backend change such as a new image
size).

## 3. Build the route

```text
src/routes/design_study/<topic>/      # folder name with `_`; URL and file name with `-`
  design-study-<topic>.tsx            # the route: loader, the page, the study bar
  options.tsx                         # one component per option; option 0 is the current design
  parts.tsx                           # what the options share
  notes.ts                            # the options' notes (`StudyOption[]`)
  study-bar.tsx                       # copy of assets/study-bar.tsx
```

- **Where it's mounted** comes from the route file's name: `design-study-<topic>.tsx` inside the site's layout (id
  `/_site-layout/design-study/<topic>`, with the real header and footer); `design-study-<topic>.bare.tsx` outside every
  layout (id `/design-study/<topic>`), for a header or footer study that draws its own. A project with another layout
  (an admin shell, say) adds a place for it to `designStudies` in `src/routes.ts`.
- **Restart the dev server after adding or removing a study folder.** It reads `src/routes.ts` once at startup, and until
  then it answers 404. Stop the old server by its exact PID after checking its folder (`ss -ltnp`,
  `readlink /proc/<pid>/cwd`), never with `pkill -f`: another project's server may be running on this machine.
- Keep the option in the URL (`?opt=2`, `?opt=3b`), extending the page's own search schema, so filters and other state
  keep working and a view can be linked. The router reads `?opt=2` as a number and writes back what the schema returns, so
  keep both types (`z.union([z.string(), z.number()]).optional().catch(undefined)`, read with `String(opt ?? 0)`) and
  navigate with a number for a plain digit; a digit as a string comes out as `?opt=%222%22`.
- Reuse the page's real wiring: the same loader, queries and components. Copy into the study what the option must reshape;
  option 0 is the live component, or a copy of it when the page writes it inline.
- Keep the page's surroundings (the section head, the panel beside it), so each option is judged in place.
- Write with Tailwind classes and logical properties (`ms-`, `start-`, `text-start`), so a picked option moves to `src/`
  nearly as it is and works in both directions. `@source` in `src/styles.css` scans the study folder, which Tailwind would
  otherwise skip as gitignored; it can only reach it by that literal path, which is why this is the one nested folder
  under `src/routes/`.
- Language, theme and width are the app's own: the header's switches and the browser window. No toggles to build.
- Use only the app's tokens (`src/styles.css`). An option that needs a new one sets it on the study's own element and says
  so under **Build**.
- When colour tells kinds apart (dates in a calendar, series, statuses), pick the hues with the `dataviz` skill's
  validator, not by eye (all pairs when every kind can be on screen at once, in both modes), check each ink's contrast on
  its tint, and give every kind a second cue (a shape, a label), so colour is never the only one.
- Keep the study bar's keys off anything the page already uses (a carousel's arrows), and keep the page's last content
  clear of the bar's height.

## 4. Check it before handing over

`oxlint` and Prettier skip gitignored files, so run `pnpm typecheck`, which generates the route tree with the study and
covers it. Then copy `scripts/shoot-study.mjs` to `.tmp-claude/<topic>-study/` and shoot every option; it shoots desktop
and phone by default. Look at every image yourself. At the least, check every option in Persian light on desktop and
phone, and the new ones in English dark. Press the real keys with Playwright too (swipe a carousel, open a popup), and
watch for page errors. Fix what you find: overflow, text over a banner's text, uneven columns, a rule running past its
column, a dark surface that disappears. Report anything you could not fix.

## 5. Hand over

Reply in a few short paragraphs:

1. the problem, in one or two sentences;
2. one short paragraph per option: what it is, what's good, what to watch;
3. your honest pick and why, and the safe alternative if it differs; ask which one to build;
4. last of all, the URL to visit (`http://localhost:5173/design-study/<topic>`, `/en/…` for English), and that keys 0–4
   pick (b–h a version, a back to the plain one) and `n` shows or hides the notes. The URL always ends the reply, one per
   study, so it is never lost above the notes. Any later reply about the study (new options, a fix, a built pick) ends
   with the URL to look at too.

Leave the dev server running for the user, and say so. Record the study in memory: the topic, the options and that the
pick is pending.

## Follow-ups

- **"Give me four more"**: add options 5–8 to the same route, with the same notes and checks. Recommend across all of them,
  not only the new ones.
- **"Give me N other versions of option K"**: add them as options `Kb`, `Kc`. Variations should still differ in idea within
  K's family (a front page, a ruled list, a chronicle), not only in spacing.
- **"Mix 3 with the band from 8"**: make it a version of the closer option, and say what it borrows.

## Building the pick

Once the user picks, build only that option in `src/`, following `docs/frontend-flow.md`:

- Move the option's code out of the study. Nothing tracked may import from `src/routes/design_study/`.
- Change the primitives and `src/styles.css` where the design needs it (a variant, a token) instead of bending the design
  to fit them, and add or update the primitive's story. Study-only words become real messages in both languages.
- Delete what the old design leaves unused: components, message keys in both `messages/*.json`, tokens.
- Run `pnpm lint`, and `pnpm typecheck` when props or contracts changed.
- Remove the study, as below, now that its code has moved out.
- Screenshot the real page on desktop and phone, waiting for hydration. Don't resize the viewport to fit a long page:
  anything sized by the viewport (a hero) grows with it. A sticky header shows over the top of an element screenshot;
  that's expected.
- End the reply with the URL of the real page the pick landed on.
- Commit and push only when the user says so. commitlint caps body lines at 100 characters.
- Update the study's memory note with the outcome and the commit.

## Removing a study

A study ends when the user picks: once the pick is built, or when they drop the study without one. Don't wait to be asked.
A finished study still costs something: `tsc` keeps checking it, so a later refactor can fail over code nobody uses, and
`git status` never shows it.

1. Make sure `.tmp-claude/<topic>-study/shots/` has every option, option 0 included, on desktop and phone, and shoot any
   that are missing: the screenshots are what's left of the study, and `.tmp-claude/` is where they stay.
2. `rm -rf src/routes/design_study/<topic>`, then restart the dev server. Nothing else to clean up: no tracked file names
   it.
3. Say in the reply that the route is gone and where the screenshots are.

## Pitfalls

- A study is gone on a fresh clone and can't be shared by link: it lives only on this machine. Its screenshots are in
  `.tmp-claude/<topic>-study/shots/`.
- `git status` won't show a study, so nothing reminds anyone it exists. `ls src/routes/design_study` does.
- A production build (`pnpm build`) mounts no study, but a dev server running beside it writes the studies back into
  `routeTree.gen.ts` within seconds, and the build then bundles them. Stop the dev server before a local build, and
  check with `grep -rl design-study .output`. The server's build can't hit this: it has no study folder.
- Some sites answer `HeadlessChrome` with an error; `shoot-study.mjs` passes a normal Chrome user agent.
- When clipping a screenshot from `boundingBox()`, add `scrollY` to `y` and pass `fullPage: true`.
- Don't put a photo's text under an overlay: banners often carry text to their edges.
- Content that isn't translated (Persian titles on the English page) needs `dir="auto"` so it reads in its own
  direction.
