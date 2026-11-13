import { existsSync, readdirSync } from "node:fs";

import { index, layout, rootRoute, route } from "@tanstack/virtual-file-routes";

/*===== Design Studies =====*/

const STUDIES = `${import.meta.dirname}/routes/design_study`;

type StudyPlace = "site" | "bare";

/**
 * A design study is a gitignored slice served at `/design-study/<topic>` (the `design-study` skill). Its route file's
 * name says where it is mounted: `design-study-<topic>.tsx` inside the site's layout, `.bare.tsx` outside every layout
 * (a header or footer study). Studies are found on disk, so a checkout has only the studies it holds, and deleting
 * one's folder removes its route once the dev server restarts. A production build mounts none, though a dev server
 * running beside it writes them back into `routeTree.gen.ts` within seconds, so stop it before building on a machine
 * with studies. The one nested folder under `src/routes/`, because Tailwind can only reach a gitignored folder by its
 * literal path.
 */
function designStudies(place: StudyPlace) {
  if (process.env.NODE_ENV === "production" || !existsSync(STUDIES)) return [];
  return readdirSync(STUDIES).flatMap((folder) => {
    const topic = folder.replaceAll("_", "-");
    const file = `design-study-${topic}${place === "site" ? "" : `.${place}`}.tsx`;
    return existsSync(`${STUDIES}/${folder}/${file}`)
      ? [route(`/design-study/${topic}`, `design_study/${folder}/${file}`)]
      : [];
  });
}

/*===== Routes =====*/

// The route tree, declared in code so route slices stay flat folders under `src/routes/` (CLAUDE.md → Route Slices).
// File paths are relative to `src/routes/`. The TanStack Start plugin turns this into `src/routeTree.gen.ts`.
export const routes = rootRoute("__root.tsx", [
  layout("site_layout/site-layout.tsx", [
    index("home/home.tsx"),
    route("/auth", "auth/auth.tsx"),
    layout("notes_layout/notes-layout.tsx", [route("/notes", "notes/notes.tsx")]),
    ...designStudies("site"),
    // Last, and for every address nothing above answers: a 404 inside the site's header and footer.
    route("/$", "not_found/not-found.tsx"),
  ]),
  ...designStudies("bare"),

  /*===== Server Routes =====*/
  // No component: each answers HTTP requests itself (`server.handlers`).
  route("/api/auth/$", "api_auth/api-auth.ts"),
  route("/rpc/$", "rpc/rpc.ts"),
  route("/healthz", "healthz/healthz.ts"),
  route("/robots.txt", "robots/robots.ts"),
  route("/sitemap.xml", "sitemap/sitemap.ts"),
]);
