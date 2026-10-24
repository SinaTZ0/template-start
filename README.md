# Project Template

A starting point for full-stack [TanStack Start](https://tanstack.com/start) apps, Persian first (right-to-left) with
English as a second language.

- **Backend:** contract-first [oRPC](https://orpc.dev) v2, Drizzle + Postgres, Better-Auth (email + password, Altcha
  captcha on sign-up), image uploads processed with sharp into S3-compatible storage, pino logging, and error tracking
  with a small self-hosted error viewer (`tools/error-viewer`, Go + SQLite).
- **Frontend:** flat route slices, shadcn components rebuilt as `primitive/`s on Base UI, Tailwind v4 tokens with
  light/dark themes, TanStack Query as the one data cache (filled by route loaders, preloaded on hover), typed search
  params, Jotai and Storybook, and Persian and English messages with [Paraglide JS](https://paraglidejs.com)
  (`/notes`, `/en/notes`).
- **Example feature:** notes (`src/orpc/note/`, `src/routes/notes/`) shows the whole path: a guarded page, a loader that fills the Query cache,
  a form with server field errors, an image upload and a delete.

## Getting Started

Requirements: Node 24, pnpm, Docker (for the dev services), Go 1.26+ (for the error viewer).

```bash
pnpm install
cp .env.example .env          # then set the two secrets
pnpm services                 # Postgres on 5432, SeaweedFS (S3) on 8333, media bucket
pnpm db:migrate               # create the tables
pnpm db:seed                  # optional: the admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
pnpm dev                      # http://localhost:5173
pnpm errors                   # optional, in a second terminal: error viewer on http://localhost:8000
```

Generate the secrets with `openssl rand -base64 32`. `pnpm install` also installs the git hooks: staged files are
linted and formatted before each commit, and commit messages must follow
[Conventional Commits](https://www.conventionalcommits.org) (`feat: add note search`, `fix(auth): …`).

## Scripts

| Script                            | What it does                                     |
| --------------------------------- | ------------------------------------------------ |
| `pnpm dev` / `build` / `start`    | Dev server, production build, production server  |
| `pnpm lint` / `typecheck`         | oxlint; message compile + tsc                    |
| `pnpm lint:tw`                    | Lists non-canonical Tailwind classes (advisory)  |
| `pnpm i18n:compile`               | Compiles `messages/` into `src/paraglide/`       |
| `pnpm format`                     | Prettier (sorts Tailwind classes)                |
| `pnpm test`                       | Vitest (integration tests need the database)     |
| `pnpm test:e2e`                   | Playwright against the production build          |
| `pnpm storybook`                  | Component previews on port 6006                  |
| `pnpm db:generate` / `db:migrate` | Record a schema change as a migration; apply it  |
| `pnpm services`                   | Starts `compose.dev.yaml` and creates the bucket |
| `pnpm errors`                     | The error viewer on port 8000, with `go run`     |

## Layout

```text
src/
  routes.ts, styles.css            virtual route config (set in tsr.config.json), theme tokens
  router.tsx, server.ts, client.tsx  router + QueryClient, server entry (tracing, logs), browser entry
  routes/__root.tsx                root route: document shell, global providers
  routes/<slice>/                  one flat folder per route (docs/frontend/architecture.md)
  components/primitive/            this app's shadcn components (docs/frontend/components.md)
  components/shared/               app-made components used by several routes
  components/ui/                   untouched shadcn source, reference only
  orpc/                            the API, one folder per feature (docs/backend/architecture.md)
  lib/                             auth, viewer query, storage, logger, helpers
  db/                              Drizzle schema, client, seed
  paraglide/                       generated message functions (gitignored, docs/frontend/i18n.md)
messages/, project.inlang/         the text per locale; Paraglide settings and config
drizzle/                           SQL migrations (generated, committed)
deploy/                            Caddyfile and the production jobs (migrate, init-storage)
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
   and a `SITE_IMAGE` for link previews in `src/lib/site.ts`. Keep English, or change the languages
   (`docs/frontend/i18n.md` → Adding or Removing a Language).
3. Design the look. Everything that ships (colours, type styles, radius and shadows in `src/styles.css`, the primitives'
   styles) is a neutral placeholder. Design the homepage, then give it to an agent with
   `docs/customize-template.md`, which turns it into app-identity, tokens, primitives, header, footer and the home
   route.
4. Rewrite this README and the first paragraph of `CLAUDE.md` for the project.
5. Build the first real feature by copying the shape of `note`, then delete the example (`src/orpc/note/`,
   `src/routes/notes*`, the `note` table, its entries in `contract.ts`, `router.ts` and `routes.ts`). Before the first
   deploy, replace `drizzle/` with one fresh migration: delete the folder and run `pnpm db:generate --name init`.
6. Deploy with `compose.prod.yaml` and go through "Before Going Live" in `docs/deployment.md`.
