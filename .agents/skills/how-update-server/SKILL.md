---
name: how-update-server
description: How a change in this repo reaches the production server, and writing the deploy step a commit needs when `deploy/deploy.sh update` alone won't change the server's data. Use before committing any change to seed data or a seed script (`src/db/seed-*.ts`, the paths in `deploy/steps/needs-step.txt`), when the `deploy-steps` commit hook fails, and whenever the user asks "HOW UPDATE SERVER", "what do I run on the server", "does this need a seed", "will the server show this", "how do I deploy this", or before telling the user a change is live. Classifies the diff (code, migration, seed data, .env variable, Caddy/Compose, the deploy tool itself), writes the `deploy/steps/` file with the exact commands, and says what each one overwrites.
---

# How Update Server

`deploy/deploy.sh update` on the server pulls `main`, rebuilds the image, runs pending migrations, swaps the app
without downtime, then **runs the deploy steps** the server hasn't run yet (`docs/deployment.md` → Deploy Steps). Code
and schema need nothing more. Data the database already holds (whatever a seed loaded) only changes through a step: a
file in `deploy/steps/` that the commit adds. This skill decides whether a commit needs one and writes it.

## Steps

1. **Find what the commit changes.** Before committing: `git status --short` and `git diff --stat` (staged and not).
   For a question about what the server is missing: `git fetch -q && git log --oneline origin/main..HEAD` (not pushed
   yet; the server only gets pushed commits), or ask the user which commit the server is on.

2. **Match every changed path against the table below.** `deploy/steps/needs-step.txt` lists the paths the commit hook
   checks; the table says which command each one needs.

3. **Write the step**, when a row says so, in the same commit as the change (format in `deploy/steps/README.md`):

   ```md
   ---
   run:
     - seed notes --replace
   ---

   The sample notes were rewritten in src/db/seed-notes.ts. This replaces the first admin's sample notes; their own
   notes stay.
   ```

   - Name it `deploy/steps/<yyyymmdd>-<hhmm>-<what>.md`, with the current date and time (`date +%Y%m%d-%H%M`).
   - One step for the commit, its commands in the order they must run. Commands that depend on each other go in the
     same step, never in two.
   - Narrow `--replace` to what changed, when the seed takes names: it deletes what it reloads.
   - The body says what changed and what the commands overwrite on the server.
   - Only `seed …` commands are allowed, and each must be safe to run twice (the deploy repeats a command that was
     stopped halfway).
   - Never edit a committed step (the hook refuses): add a new one. Deleting one is fine.

4. **Or decide no step.** When editors already changed that content on the site, or the change only matters for a new
   server, ask the user, and on their word add a line `Deploy-Step: none` to the commit message instead.

5. **Tell the user** what the next update will do: the steps it runs, roughly how long they take, and what each
   `--replace` deletes. Ask before a `--replace` whether editors have changed that content on the site, because those
   edits are lost. When nothing beyond `update` is needed, say so plainly. Commit and push only when the user asks.

Run commands on the server only when the user asks; it's reached over SSH, and commands are typed in the checkout
there or picked from the `deploy/deploy.sh` menu.

## What Each Change Needs

| Changed paths                                                                                         | What the commit needs                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/`, `src/components/`, `src/styles.css`, `src/orpc/**` logic, `messages/*.json`, `public/` | Nothing. The new image serves it.                                                                                                                                                                                                                                             |
| `src/db/schema.ts` **with** a new file in `drizzle/`                                                  | Nothing: `update` runs the migration. Drops or renames still read by the old code: split over two deploys (`docs/deployment.md` → Database Changes).                                                                                                                          |
| `src/db/schema.ts` **without** a new `drizzle/` file                                                  | Stop: the migration is missing. `pnpm db:generate --name <what>`, check it, commit it with the code.                                                                                                                                                                          |
| `src/db/seed-notes.ts` (the sample notes, or how they load)                                           | Step: `seed notes --replace` (deletes the first admin's sample notes and loads them again; their own notes stay), or `Deploy-Step: none` when only new servers need it.                                                                                                     |
| A project's own seed (its data and script, listed in `needs-step.txt`)                                | Step with the `seed <part>` command and the narrowest `--replace` that reaches the change; `seed <part>` alone when only new rows were added.                                                                                                                                 |
| `src/env.server.ts` + `.env.production.example` (a new variable)                                      | `update` adds it to `.env`, generates it or asks for it; from cron the update stops before the build until it's set. All four places: `docs/deployment.md` → Adding a Variable.                                                                                              |
| `deploy/Caddyfile`, `compose.prod.yaml`, `Dockerfile`, `deploy/*.mjs`                                 | Nothing extra: `update` rebuilds, applies Compose and reloads Caddy.                                                                                                                                                                                                          |
| `tools/deploy/**` (the Go deploy tool)                                                                | Before committing: `pnpm deploy:build`, commit `deploy/bin/` with it (the pre-commit hook enforces it). Renamed a command a step uses? Delete the steps that already ran on the server, fix the ones that haven't. A new kind of step: an entry in `stepCommands` (`tools/deploy/internal/commands/steps.go`), safe to run twice. |
| `tools/error-viewer/**`                                                                               | Nothing; it restarts in place when its image changes.                                                                                                                                                                                                                         |
| A new admin is needed                                                                                 | Not a step (it needs an email): the user runs `deploy/deploy.sh admin <email>` after they sign up.                                                                                                                                                                           |

Content an editor adds or edits on the site is already on the server; it needs no deploy at all.

## Checking It Worked

- `deploy/deploy.sh status`: the app is healthy, and the Steps line says `all done`. Yellow means steps wait for the
  next deploy; red names the step and command that stopped (`deploy/deploy.sh steps --list` shows them all).
- After a failure, fix the cause and run `deploy/deploy.sh steps` (or the next update): it carries on from the command
  that failed.
- Open the changed page on the site (and `/en/...` when text changed).
- A seed prints `Skipped …` for what it left alone. Seeing that for the thing you meant to change means the step is
  missing `--replace`.

## Keep This Current

When a new kind of server-side data or a new `deploy/deploy.sh` command appears (a new seed part), add its row here and
its paths to `deploy/steps/needs-step.txt` in the same change.
