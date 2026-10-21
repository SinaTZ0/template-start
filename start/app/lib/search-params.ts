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
