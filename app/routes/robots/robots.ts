import { SITE_ORIGIN } from "~/lib/site.server";

/*===== robots.txt =====*/
/**
 * `GET /robots.txt`: lets crawlers in everywhere except the API, and points them at the sitemap.
 *
 * Private pages aren't listed here: a `Disallow` would stop crawlers from reading their `noindex` tag, and would publish
 * their paths. `pageMeta({ index: false })` keeps them out of search results instead.
 */
export function loader() {
  const body = ["User-agent: *", "Disallow: /api/", "Disallow: /rpc/", "", `Sitemap: ${SITE_ORIGIN}/sitemap.xml`, ""];

  return new Response(body.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
