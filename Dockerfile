# syntax=docker/dockerfile:1

# Production image: the built app, runtime dependencies only, and the deploy scripts (`migrate.mjs`,
# `init-storage.mjs`) that `compose.prod.yaml` runs from the same image. See docs/deployment.md.

# ===== Base =====
FROM node:24-slim AS base
WORKDIR /app
# pnpm at the version in package.json's `packageManager`.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

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

# ===== Runtime =====
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Maps error stacks back to the source with the server bundle's source maps, so logs and error reports name real files.
ENV NODE_OPTIONS=--enable-source-maps

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
COPY drizzle ./drizzle
COPY deploy/migrate.mjs deploy/init-storage.mjs ./deploy/

USER node
EXPOSE 3000
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]
