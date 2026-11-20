# Project Template

A starting point for full-stack [TanStack Start](https://tanstack.com/start) apps, Persian first (right-to-left) with
English as a second language.

- **Backend:** contract-first [oRPC](https://orpc.dev) v2 with every procedure implemented on
  [Effect](https://effect.website) v4 (services and layers, typed errors), Effect Schema for contracts, forms, search
  params and domain rules, Drizzle + Postgres on Effect's Postgres driver, Better-Auth (email + password, Altcha
  captcha on sign-up, email confirmation and password reset), background jobs on Effect's persisted queue in the same
  Postgres, email through one regular mailbox over SMTP with React Email templates, image uploads processed with sharp
  into S3-compatible storage, logging and tracing through Effect with optional OpenTelemetry export (OpenObserve), and
  error tracking with a small self-hosted error viewer (`tools/error-viewer`, Go + SQLite).
- **Frontend:** flat route slices, shadcn components rebuilt as `primitive/`s on Base UI, Tailwind v4 tokens with
  light/dark themes, TanStack Query as the one data cache (filled by route loaders, preloaded on hover), typed search
  params, Jotai and Storybook, and Persian and English messages with [Paraglide JS](https://paraglidejs.com)
  (`/notes`, `/en/notes`).
- **Example feature:** notes (`src/orpc/note/`, `src/routes/notes/`, `src/routes/notes_noteId/`) shows the whole
  path: a guarded page, a loader that fills the Query cache, a list paged through the URL, a form with server field
  errors that creates and edits, an image upload, a delete, a 404 for a missing note and a number only admins see.

## Getting Started

Requirements: Node 26, pnpm, Docker (for the dev services), Go 1.26+ (for the error viewer).

```bash
pnpm install                  # in a git repository (`git init` first), so the git hooks are installed
cp .env.example .env          # then set BETTER_AUTH_SECRET and ALTCHA_HMAC_KEY
pnpm services                 # Postgres on 5432, SeaweedFS (S3) on 8333, media bucket, Mailpit on 8025
pnpm db:migrate               # create the tables
pnpm db:seed                  # optional: the admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
pnpm db:seed:notes            # optional: sample notes for that admin
pnpm dev                      # http://localhost:5173
pnpm errors                   # optional, in a second terminal: error viewer on http://localhost:8000
```

- **Secrets.** Generate each of the two with `openssl rand -base64 32`.
- **Signing in.** Sign up at `/auth` and open the confirmation link from the email in Mailpit
  (http://localhost:8025, where every email the app sends in development lands), or sign in as the seeded admin with
  `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from `.env`.
- **Error viewer.** The app reports to it only when `.env` has `SENTRY_DSN=http://developmentkey@localhost:8000/1`
  (restart `pnpm dev` after setting it). The viewer's password is `admin`.
- **Traces.** Optional: `docker compose -f compose.dev.yaml --profile observability up -d` starts OpenObserve on
  http://localhost:5080 (`dev@example.com`, password `Dev-pass-1`). The app exports its traces, metrics and logs
  there once `.env` sets `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` (`.env.example` has the
  values).
- **Git hooks.** `pnpm install` installs them: staged files are linted and formatted before each commit, and commit
  messages must follow [Conventional Commits](https://www.conventionalcommits.org) (`feat: add note search`,
  `fix(auth): …`). Outside a git repository they are skipped; run `pnpm install` again after `git init`.
- **Browser tests.** `pnpm test:e2e` needs Playwright's browser once: `pnpm exec playwright install chromium`.

## Scripts

| Script                            | What it does                                                             |
| --------------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev` / `build` / `start`    | Dev server, production build, production server                          |
| `pnpm lint` / `lint:fix`          | oxlint, the message check and the Effect rules; oxlint's automatic fixes |
| `pnpm typecheck`                  | Compiles messages and routes, then tsc with Effect's diagnostics         |
| `pnpm lint:tw`                    | Lists non-canonical Tailwind classes (advisory)                          |
| `pnpm i18n:compile`               | Compiles `messages/` into `src/paraglide/`                               |
| `pnpm format` / `format:check`    | Prettier (sorts Tailwind classes); the check CI runs                     |
| `pnpm test` / `test:watch`        | Vitest (integration tests need the database)                             |
| `pnpm test:e2e`                   | Playwright against the production build (needs `pnpm services`)          |
| `pnpm check`                      | typecheck, lint, format check and tests, as CI                           |
| `pnpm storybook`                  | Component previews on port 6006                                          |
| `pnpm services` / `services:down` | Starts `compose.dev.yaml` and creates the bucket; stops it               |
| `pnpm db:generate` / `db:migrate` | Record a schema change as a migration; apply it                          |
| `pnpm db:check` / `db:studio`     | Checks the migrations for conflicts; Drizzle Studio                      |
| `pnpm db:reset`                   | Empties the dev database and applies the migrations                      |
| `pnpm db:seed` / `db:seed:notes`  | The first admin; sample notes for that admin                             |
| `pnpm db:push`                    | Schema straight into a throwaway database, never one `db:migrate` ran    |
| `pnpm errors`                     | The error viewer on port 8000, with `go run`                             |
| `pnpm deploy:build`               | Rebuilds the deploy tool's binary after a change in `tools/deploy/`      |

## Layout

```text
src/
  routes.ts, styles.css            virtual route config (set in tsr.config.json), theme tokens
  router.tsx, server.ts, client.tsx  router + QueryClient, server entry (traces, logs, job workers), browser entry
  jobs.server.ts                   every background job the workers run (docs/backend/jobs.md)
  routes/__root.tsx                root route: document shell, global providers
  routes/<slice>/                  one flat folder per route (docs/frontend/architecture.md)
  components/primitive/            this app's shadcn components (docs/frontend/components.md)
  components/shared/               app-made components used by several routes
  components/ui/                   untouched shadcn source, reference only
  orpc/                            the API, one folder per feature (docs/backend/architecture.md)
  server/                          Effect services: AppConfig, database, jobs, auth, mail, storage, observability
  lib/                             schema helpers (Effect Schema), auth client, viewer query, locale, helpers
  mail/                            email templates and the job that sends them (docs/backend/mail.md)
  db/                              Drizzle schema, seeds
  paraglide/                       generated message functions (gitignored, docs/frontend/i18n.md)
messages/, project.inlang/         the text per locale; Paraglide settings and config
drizzle/                           SQL migrations (generated, committed)
deploy/                            deploy.sh (the deploy tool's binary in bin/), Caddyfile, production jobs, steps/
tools/deploy/, tools/error-viewer/ the deploy tool's Go source (docs/deploy-tool.md), the error viewer
docs/                              start at backend-flow.md or frontend-flow.md
```

## Starting a New Project

1. Copy the template without its git history:

   ```bash
   git clone --depth 1 https://github.com/SinaTZ0/template-start.git my-app
   cd my-app
   rm -rf .git && git init && git branch -M main
   ```

   `pnpm dlx degit SinaTZ0/template-start my-app` does the same without the git step (then run `git init` in it).

2. Rename: `name` in `package.json`, `compose.dev.yaml` and `compose.prod.yaml` (and `image` there), the bucket name in
   `.env.example` and `.env.production.example`, the `site_name` and `site_description` messages in `messages/*.json`,
   the image `siteImage()` returns for link previews in `src/lib/site.ts`, and the time zone dates are shown in
   (`APP_TIME_ZONE` in `src/lib/locale.ts`). Put the project's git URL in
   `tools/deploy/repository.txt` and rebuild the deploy tool (`pnpm deploy:build`), so Set up on a new server offers
   this repository. Keep English, or change the languages (`docs/frontend/i18n.md` → Adding or Removing a Language).
3. Design the look. Everything that ships (colours, type styles, radius and shadows in `src/styles.css`, the primitives'
   styles) is a neutral placeholder. Design the homepage, then give it to an agent with
   `docs/customize-template.md`, which turns it into app-identity, tokens, primitives, header, footer and the home
   route.
4. Rewrite this README and the first paragraph of `CLAUDE.md` for the project.
5. Build the first real feature by copying the shape of `note`, then delete the example (Deleting the Note Example
   below). Before the first deploy, replace `drizzle/` with one fresh migration: delete the folder and run
   `pnpm db:generate --name init`.
6. Deploy with `compose.prod.yaml` and go through "Before Going Live" in `docs/deployment.md`.

## Deleting the Note Example

Once the project has a feature of its own, remove `note` everywhere it reaches. `pnpm typecheck` and `pnpm lint` find
most of what is left behind; the deploy tool and the docs they can't see.

- **API:** `src/orpc/note/`, its entries in `src/orpc/contract.ts` and `src/orpc/router.ts`, and its two layers in
  `AppLayer` (`src/server/runtime.server.ts`).
- **Pages:** `src/routes/notes/`, `src/routes/notes_noteId/` and `src/components/shared/note-form/`, and their two
  routes in `src/routes.ts`. `src/routes/notes_layout/` is the signed-in guard: keep it, renamed, for the project's
  own signed-in pages.
- **Links to `/notes`:** `ROLE_HOME` in `src/lib/viewer.ts` (where sign-in lands), the navigation in
  `src/components/shared/site-header/site-header.tsx`, and the button in `src/routes/home/home.tsx`.
- **Database:** the `note` table in `src/db/schema.ts`, with a migration that drops it (or the fresh `init` migration
  of step 5).
- **Seed:** `src/db/seed-notes.ts`, the `db:seed:notes` script, its file in the Dockerfile's esbuild line, its path in
  `deploy/steps/needs-step.txt`, and the `notes` part of the deploy tool (`Seed`, `checkSeed` and `seedNotes` in
  `tools/deploy/internal/commands/misc.go`, and the help text), followed by `pnpm deploy:build`. A project with no
  seed of its own removes the esbuild step and the `COPY` of its output from the Dockerfile.
- **Messages:** every `notes_*` and `note_error_*` key, `nav_notes` and `home_go_to_notes`, in each file of
  `messages/`.
- **Tests:** `e2e/notes.spec.ts` walks the note pages after signing up (`signUpAndConfirm`): keep its sign-up and sign-out, and replace
  the middle with the project's main flow. `e2e/locale.spec.ts` clicks the Notes link; point it at a guarded page of
  the project.
- **Docs:** the rule docs name `note` files as their examples. Point them at the project's feature as it replaces
  them, along with the paragraph about `note` in `CLAUDE.md`.
