import { SITE_ORIGIN } from "~/lib/site.server";

/*===== Entries =====*/
type SitemapEntry = { path: string; lastModified?: Date };

// Every public page meant for search results. Pages with `pageMeta({ index: false })` stay out.
const STATIC_ENTRIES: SitemapEntry[] = [{ path: "/" }];

/*===== sitemap.xml =====*/
/**
 * `GET /sitemap.xml`: the pages search engines should list, for `robots.txt` to point at.
 *
 * Content pages (articles, products) add one entry each here, read through `createServerClient(request)` from a
 * procedure that returns only published items, with `lastModified` from their update time (`docs/frontend/seo.md`).
 */
export function loader() {
  const entries = STATIC_ENTRIES;

  const urls = entries.map(({ path, lastModified }) => {
    const lastmod = lastModified ? `<lastmod>${lastModified.toISOString()}</lastmod>` : "";
    return `<url><loc>${escapeXml(new URL(path, SITE_ORIGIN).href)}</loc>${lastmod}</url>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>\n`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

/** Escapes the characters XML reserves. URLs can hold `&` (a query) and Persian slugs are percent-encoded by `URL`. */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
