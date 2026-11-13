import { execFileSync } from "node:child_process";

import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { traceLayers } from "./vite-plugins/trace-layers.ts";

/**
 * The build's release: the commit it was built from, which error reports carry so the viewer can say which build
 * failed. The deploy tool passes it as `APP_RELEASE` (the image build has no `.git`); a build on a developer's machine
 * asks git. Empty when neither is there, and reports then carry no release.
 */
function appRelease(): string {
  if (process.env.APP_RELEASE) return process.env.APP_RELEASE;
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

export default defineConfig(({ command }) => {
  // Read through `envPrefix` below, like `SENTRY_DSN`. Only a build has a release: the dev server runs uncommitted code.
  if (command === "build") process.env.APP_RELEASE = appRelease();

  return {
    plugins: [
      // First, as the devtools plugin requires. It removes the devtools from production builds.
      devtools(),
      tailwindcss(),
      // Compiles `messages/` into `src/paraglide/` before anything imports it, and again when a message file changes.
      // Its options are in `project.inlang/paraglide.config.ts` (docs/frontend/i18n.md).
      // A build writes one module per message, so messages no page uses drop out of the bundle.
      paraglideVitePlugin({
        project: "./project.inlang",
        ...(command === "build" && { outputStructure: "message-modules" as const }),
      }),
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
    server: {
      // Prints the browser's uncaught errors and `console.error` / `console.warn` in the dev server's terminal, where an
      // agent running it can read them. Left unset, Vite turns it on only when it detects an agent, which adds a plugin,
      // and plugin names are part of the dependency cache's hash: each dev server started by the other side then
      // re-optimized every dependency (seconds more to start). Pinned, everyone shares one cache.
      forwardConsole: true,
    },
    // `SENTRY_DSN` is the one server variable the browser needs (`src/client.tsx`), and `APP_RELEASE` names the build
    // on both sides. Vite reads them from `.env` or the build's environment and inlines them at build time.
    envPrefix: ["VITE_", "SENTRY_DSN", "APP_RELEASE"],
    // The server bundle's source maps let Node map error stacks back to the source (`--enable-source-maps` in the
    // Dockerfile), so reported stacks point at real files. The client's are written next to the built files without a
    // link from them (`hidden`): the error viewer reads them from the app to map browser stacks, and Caddy refuses them
    // to everyone else (`deploy/Caddyfile`), since they hold the source.
    environments: {
      ssr: { build: { sourcemap: true } },
      client: { build: { sourcemap: "hidden" } },
    },
  };
});
