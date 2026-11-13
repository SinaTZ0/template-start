import { z } from "zod";

/*===== Redirect Target =====*/
// Any origin works as the base: it only shows whether the value leaves it.
const SAME_SITE_BASE = "http://same.site";
// Browsers drop tabs and line breaks from a URL before reading it, so `/<tab>/evil.com` is `//evil.com` to them.
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

/**
 * The same-site path in `value`, or `undefined` when it could lead to another site.
 *
 * Checked on the path a browser ends up with, not on the text: `/.//evil.com` starts with a single slash, but its dot
 * segment collapses into the protocol-relative `//evil.com`. Backslashes are rejected because browsers read
 * `/\evil.com` the same way. The normalized path is returned, so what was checked is what gets used.
 */
export function sameSitePath(value: string | undefined): string | undefined {
  if (!value?.startsWith("/") || value.includes("\\") || CONTROL_CHARACTERS.test(value)) return undefined;
  if (!URL.canParse(value, SAME_SITE_BASE)) return undefined;

  const url = new URL(value, SAME_SITE_BASE);
  if (url.origin !== SAME_SITE_BASE || url.pathname.includes("//")) return undefined;
  return url.pathname + url.search + url.hash;
}

/**
 * A same-site path to go to after signing in, for `?redirectTo=`. Anything else reads as missing, so a crafted link
 * can't send someone to another site (`sameSitePath`).
 *
 * Missing stays `undefined` rather than a default: the router writes validated defaults back into the URL.
 */
export const redirectToParam = z.string().optional().catch(undefined).transform(sameSitePath);

/*===== List Filters =====*/
// A list page's search text (`?q=`) and one-of filter (`?group=`), for lists filtered in the page (`matchesSearch` in
// `#/lib/persian-text`). `group` stays a string here; each page falls back to «all» for an id it doesn't have.

export const listSearchDefaults = { q: "", group: "all" } as const;

export const listSearchSchema = z.object({
  q: z.string().trim().max(100).default(listSearchDefaults.q).catch(listSearchDefaults.q),
  group: z.string().max(40).default(listSearchDefaults.group).catch(listSearchDefaults.group),
});
