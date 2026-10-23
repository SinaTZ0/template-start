import { defineConfig } from "@inlang/paraglide-js";

/*===== Paraglide =====*/
// Read by every compile: the Vite plugin (dev, build, Storybook), Vitest and `pnpm i18n:compile` (docs/frontend/i18n.md).
export default defineConfig({
  outdir: "./src/paraglide",
  // Typed declarations for the generated JavaScript, so `tsc` checks message names and parameters.
  emitTsDeclarations: true,

  /*------ Locale Resolution ------*/
  // A page's language is its URL, nothing else: no cookie and no Accept-Language redirect, so a shared link and a
  // crawler always get the language the URL names.
  strategy: ["url", "baseLocale"],
  // The base locale has no prefix (`/notes`), every other locale does (`/en/notes`). The root rule comes first, because
  // the first matching pattern wins.
  urlPatterns: [
    {
      pattern: "/",
      localized: [
        ["en", "/en"],
        ["fa", "/"],
      ],
    },
    {
      pattern: "/:path(.*)?",
      localized: [
        ["en", "/en/:path(.*)?"],
        ["fa", "/:path(.*)?"],
      ],
    },
  ],
  routeStrategies: [
    // API calls carry no locale in their path. The browser's client sends the page's locale in a header
    // (`src/orpc/client.ts`), read by `custom-locale-header` (`src/lib/locale.server.ts`).
    { match: "/rpc/:path(.*)?", strategy: ["custom-locale-header", "baseLocale"] },
    // Machine endpoints: never redirected or prefixed.
    { match: "/api/:path(.*)?", exclude: true },
    { match: "/healthz", exclude: true },
    { match: "/robots.txt", exclude: true },
    { match: "/sitemap.xml", exclude: true },
  ],
});
