import { m } from "#/paraglide/messages";

/*===== Site =====*/
// Browser-safe identity values for page titles and link previews. The site's name and default description are the
// `site_name` and `site_description` messages, one per locale; rename them per project (docs/frontend/seo.md).

/**
 * The default link-preview image: a 1200×630 file in `public/`, e.g. `{ url: "/og.png", alt: m.site_image_alt() }`.
 * Previews show text only until a project adds one. A function, so its `alt` message is read in each request's locale.
 */
export function siteImage(): { url: string; alt: string } | null {
  return null;
}

/** `<title>` for a page: «Page | Site», or just the site name for the home page. */
export function pageTitle(page?: string): string {
  return page ? `${page} | ${m.site_name()}` : m.site_name();
}
