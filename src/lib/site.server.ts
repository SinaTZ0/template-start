import { env } from "#/env.server";

/*===== Site Origin =====*/
/**
 * The site's public origin, e.g. `https://example.com`: canonical URLs, link previews, `robots.txt` and the sitemap are
 * built on it. It comes from `BETTER_AUTH_URL`, which already holds the public address (`https://${DOMAIN}` in
 * production), rather than the request's host, which a proxy or a crafted `Host` header can change.
 */
export const SITE_ORIGIN = new URL(env.BETTER_AUTH_URL).origin;
