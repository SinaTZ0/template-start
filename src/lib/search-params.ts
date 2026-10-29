import { z } from "zod";

/*===== Redirect Target =====*/
/**
 * A same-site path to go to after signing in, for `?redirectTo=`. Anything else reads as missing, so a crafted link
 * can't send someone to another site. Backslashes are rejected because browsers read `/\evil.com` as the
 * protocol-relative `//evil.com`.
 *
 * Missing stays `undefined` rather than a default: the router writes validated defaults back into the URL.
 */
export const redirectToParam = z
  .string()
  .optional()
  .catch(undefined)
  .transform((value) =>
    value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : undefined,
  );

/*===== List Filters =====*/
// A list page's search text (`?q=`) and one-of filter (`?group=`), for lists filtered in the page (`matchesSearch` in
// `#/lib/persian-text`). `group` stays a string here; each page falls back to «all» for an id it doesn't have.

export const listSearchDefaults = { q: "", group: "all" } as const;

export const listSearchSchema = z.object({
  q: z.string().trim().max(100).default(listSearchDefaults.q).catch(listSearchDefaults.q),
  group: z.string().max(40).default(listSearchDefaults.group).catch(listSearchDefaults.group),
});
