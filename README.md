# Project Template

A starting point for full-stack React Router v8 apps, in Persian and right-to-left.

- **Backend:** contract-first [oRPC](https://orpc.dev) v2, Drizzle + Postgres, Better-Auth (email + password, Altcha
  captcha on sign-up), image uploads processed with sharp into S3-compatible storage, pino logging, and error tracking
  with a small self-hosted error viewer (`tools/error-viewer`, Go + SQLite).
- **Frontend:** flat route slices, shadcn components rebuilt as `primitive/`s on Base UI, Tailwind v4 tokens with
  light/dark themes, TanStack Query, nuqs, Jotai and Storybook.
- **Example feature:** notes (`app/orpc/note/`, `app/routes/notes/`) shows the whole path: a guarded page, a loader,
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
| `pnpm lint` / `typecheck`         | oxlint; route typegen + tsc                      |
| `pnpm format`                     | Prettier (sorts Tailwind classes)                |
| `pnpm test`                       | Vitest (integration tests need the database)     |
| `pnpm test:e2e`                   | Playwright against the production build          |
| `pnpm storybook`                  | Component previews on port 6006                  |
| `pnpm db:generate` / `db:migrate` | Record a schema change as a migration; apply it  |
| `pnpm services`                   | Starts `compose.dev.yaml` and creates the bucket |
| `pnpm errors`                     | The error viewer on port 8000, with `go run`     |

## Layout

```text
app/
  routes.ts, root.tsx, app.css     route config, document shell, theme tokens
  routes/<slice>/                  one flat folder per route (docs/frontend/architecture.md)
  components/primitive/            this app's shadcn components (docs/frontend/components.md)
  components/shared/               app-made components used by several routes
  components/ui/                   untouched shadcn source, reference only
  orpc/                            the API, one folder per feature (docs/backend/architecture.md)
  lib/                             auth, storage, logger, session guard, helpers
  db/                              Drizzle schema, client, seed
drizzle/                           SQL migrations (generated, committed)
deploy/                            Caddyfile and the production jobs (migrate, init-storage)
docs/                              start at backend-flow.md or frontend-flow.md
```

## Starting a New Project

1. Rename: `name` in `package.json`, `compose.dev.yaml` and `compose.prod.yaml` (and `image` there), `SITE_NAME` in
   `app/lib/site.ts`, the bucket name in `.env.example` and `.env.production.example`.
2. Fill in `docs/frontend/app-identity.md` and the colour tokens in `app/app.css`. Replace `public/favicon.ico`.
3. Update the first paragraph of `CLAUDE.md`.
4. Build the first real feature by copying the shape of `note`, then delete the example (`app/orpc/note/`,
   `app/routes/notes*`, the `note` table, its entries in `contract.ts`, `router.ts` and `routes.ts`). Before the first
   deploy, replace `drizzle/` with one fresh migration: delete the folder and run `pnpm db:generate --name init`.
5. Deploy with `compose.prod.yaml` and go through "Before Going Live" in `docs/deployment.md`.
