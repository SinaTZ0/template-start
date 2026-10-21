/*===== Site =====*/
// Browser-safe identity values shown in the header, footer, page titles and link previews. Rename per project.

export const SITE_NAME = "قالب پروژه";

/** The default `description`, for pages that don't set their own. Search results and link previews show it. */
export const SITE_DESCRIPTION = "نقطه شروع پروژه‌های تازه.";

/** Open Graph's language and region code for the content. */
export const SITE_LOCALE = "fa_IR";

/**
 * The default link-preview image: a 1200×630 file in `public/`, e.g. `{ url: "/og.png", alt: "…" }`. Previews show
 * text only until a project adds one.
 */
export const SITE_IMAGE: { url: string; alt: string } | null = null;

/** `<title>` for a page: «Page | Site», or just the site name for the home page. */
export function pageTitle(page?: string): string {
  return page ? `${page} | ${SITE_NAME}` : SITE_NAME;
}
