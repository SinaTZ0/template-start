import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { traceLayers } from "./vite-plugins/trace-layers.ts";

export default defineConfig({
  plugins: [
    // First, as the devtools plugin requires. It removes the devtools from production builds.
    devtools(),
    tailwindcss(),
    // Must come before `viteReact()`: it generates the route tree and compiles server functions first. The route tree
    // is declared in code (`src/routes.ts`, set in `tsr.config.json`, which `tsr generate` reads too), so route slices
    // stay flat folders (CLAUDE.md → Route Slices).
    tanstackStart(),
    // Builds the Node server (`.output/server/index.mjs`) that serves the app and its static assets.
    nitro(),
    viteReact(),
    // `traceLayers` times feature services and repositories (docs/backend/logging.md → Request Timing).
    traceLayers(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  // `SENTRY_DSN` is the one server variable the browser needs (`src/client.tsx`). Vite reads it from `.env` or the
  // build's environment and inlines it at build time.
  envPrefix: ["VITE_", "SENTRY_DSN"],
  // The server bundle's source maps let Node map error stacks back to the source (`--enable-source-maps` in the
  // Dockerfile), so reported stacks point at real files. The client's stay off: they would publish the source.
  environments: {
    ssr: { build: { sourcemap: true } },
  },
});
