/*===== Site =====*/
// Browser-safe identity values shown in the header, footer and page titles. Rename per project.

export const SITE_NAME = "قالب پروژه";

/** `<title>` for a page: «Page | Site», or just the site name for the home page. */
export function pageTitle(page?: string): string {
  return page ? `${page} | ${SITE_NAME}` : SITE_NAME;
}
