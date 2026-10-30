# syntax=docker/dockerfile:1

# Production image: the built app, runtime dependencies only, and the deploy scripts (`migrate.mjs`,
# `init-storage.mjs`) that `compose.prod.yaml` runs from the same image, plus the seeds `deploy/deploy.sh seed` runs.
# See docs/deployment.md.

# ===== Base =====
FROM node:26-slim AS base
WORKDIR /app
# pnpm at the version in package.json's `packageManager`.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# The npm registry, for npm's download of corepack, corepack's of pnpm and pnpm's of the packages: `NPM_REGISTRY` in
# .env, a mirror for a server that can't reach registry.npmjs.org (docs/deployment.md → Package Registries). Empty uses
# npm's. pnpm reads `pnpm_config_registry` (not `npm_config_registry`), with the trailing slash.
ARG NPM_REGISTRY=""
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmjs.org} \
    npm_config_registry=${NPM_REGISTRY:-https://registry.npmjs.org}/ \
    pnpm_config_registry=${NPM_REGISTRY:-https://registry.npmjs.org}/
# Node stopped bundling corepack in v25, so it comes from npm, pinned like any other tool.
RUN npm install --global corepack@0.36.0 && corepack enable

# ===== Dependencies =====
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# `--ignore-scripts` skips `prepare` (git hooks: no repository here). sharp and esbuild ship prebuilt binaries as
# optional dependencies, so they don't need their install scripts.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --prod

# ===== Build =====
FROM deps AS build
# Inlined into the browser bundle so it can report errors (`vite.config.ts`). Empty turns browser reporting off.
ARG SENTRY_DSN=""
COPY . .
RUN pnpm build
# The seeds `deploy/deploy.sh seed` runs in a one-off container, each as one plain-JavaScript file, since the runtime
# image has no TypeScript loader or `#/` alias. Packages stay imports, read from the runtime's node_modules. A new seed
# is added to this list (docs/deployment.md → Seed).
RUN pnpm exec esbuild src/db/seed-notes.ts --bundle \
    --platform=node --format=esm --target=node26 --packages=external --sourcemap --outdir=/app/deploy-dist \
    --out-extension:.js=.mjs

# ===== Runtime =====
FROM node:26-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Maps error stacks back to the source with the server bundle's source maps, so logs and error reports name real files.
ENV NODE_OPTIONS=--enable-source-maps

COPY --from=prod-deps /app/node_modules ./node_modules
# Nitro's Node server and the static assets it serves (`vite.config.ts`).
COPY --from=build /app/.output ./.output
# The server source, read by the error reporter: with source maps, stack frames name `/app/src/<file>.ts`, and the
# Sentry SDK reads each frame's lines from that path to attach them to the report. Without it, reports carry no source.
COPY --from=build /app/src ./src
COPY package.json ./
COPY drizzle ./drizzle
COPY deploy/migrate.mjs deploy/init-storage.mjs ./deploy/
COPY --from=build /app/deploy-dist ./deploy/

USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
