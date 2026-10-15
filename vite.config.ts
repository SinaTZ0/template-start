import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { traceLayers } from "./vite-plugins/trace-layers.ts";

export default defineConfig({
  // `traceLayers` times feature services and repositories (docs/backend/logging.md → Request Timing).
  plugins: [tailwindcss(), reactRouter(), traceLayers()],
  resolve: {
    tsconfigPaths: true,
  },
  // `SENTRY_DSN` is the one server variable the browser needs (`app/entry.client.tsx`). Vite reads it from `.env` or
  // the build's environment and inlines it at build time.
  envPrefix: ["VITE_", "SENTRY_DSN"],
  // The server bundle's source maps let Node map error stacks back to the source (`--enable-source-maps` in the
  // Dockerfile), so reported stacks point at real files. The client's stay off: they would publish the source.
  environments: {
    ssr: { build: { sourcemap: true } },
  },
});
