# Project Template

A starting point for full-stack React Router v8 apps, in Persian and right-to-left.

- **Backend:** contract-first [oRPC](https://orpc.dev) v2, Drizzle + Postgres, Better-Auth (email + password, Altcha
  captcha on sign-up), image uploads processed with sharp into S3-compatible storage, and pino logging.
- **Frontend:** flat route slices, shadcn components rebuilt as `primitive/`s on Base UI, Tailwind v4 tokens with
  light/dark themes, TanStack Query, nuqs, Jotai and Storybook.
- **Example feature:** notes (`app/orpc/note/`, `app/routes/notes/`) shows the whole path: a guarded page, a loader,
  a form with server field errors, an image upload and a delete.

## Getting Started

Requirements: Node 24, pnpm, Docker (for the dev services).

```bash
pnpm install
cp .env.example .env          # then set the two secrets
pnpm services                 # Postgres on 5432, SeaweedFS (S3) on 8333, creates the media bucket
pnpm db:push                  # create the tables
pnpm db:seed                  # optional: the admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
pnpm dev                      # http://localhost:5173
```

Generate the secrets with `openssl rand -base64 32`.

## Scripts

| Script                           | What it does                                    |
| -------------------------------- | ----------------------------------------------- |
| `pnpm dev` / `build` / `start`   | Dev server, production build, production server |
| `pnpm lint` / `typecheck`        | oxlint; route typegen + tsc                     |
| `pnpm format`                    | Prettier (sorts Tailwind classes)               |
| `pnpm test`                      | Vitest (integration tests need the database)    |
| `pnpm test:e2e`                  | Playwright against the production build         |
| `pnpm storybook`                 | Component previews on port 6006                 |
| `pnpm db:push` / `db:generate` … | Drizzle Kit                                     |
| `pnpm services`                  | Starts `compose.dev.yaml`                       |

## Layout

```text
app/
  routes.ts, root.tsx, app.css     route config, document shell, theme tokens
  routes/<slice>/                  one flat folder per route (docs/frontend-guideline.md)
  components/primitive/            this app's shadcn components (docs/components.md)
  components/shared/               app-made components used by several routes
  components/ui/                   untouched shadcn source, reference only
  orpc/                            the API, one folder per feature (docs/backend-guideline.md)
  lib/                             auth, storage, logger, session guard, helpers
  db/                              Drizzle schema, client, seed
docs/                              guidelines; start with the one for the layer you touch
```

## Starting a New Project

1. Rename: `name` in `package.json` and `compose.dev.yaml`, `SITE_NAME` in `app/lib/site.ts`, the bucket name in
   `.env.example` and `compose.dev.yaml`.
2. Fill in `docs/app-identity.md` and the colour tokens in `app/app.css`. Replace `public/favicon.ico`.
3. Update the first paragraph of `CLAUDE.md`.
4. Build the first real feature by copying the shape of `note`, then delete the example (`app/orpc/note/`,
   `app/routes/notes*`, the `note` table, its entries in `contract.ts`, `router.ts` and `routes.ts`).
5. Before production: turn on email verification once mail can be sent (`auth.server.ts`), give the S3 store real
   credentials and a read-only public path (`docs/media.md`), and schedule the orphan-media cleanup if uploads matter.
