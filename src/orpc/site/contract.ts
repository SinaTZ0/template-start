import { oc } from "@orpc/contract";
import { z } from "zod";

import { commonErrors } from "#/orpc/errors";

/*===== Procedures =====*/
/** The public origin, e.g. `https://example.com`, for the absolute URLs in head tags (`absoluteUrl` in `src/lib/seo.ts`). */
export const siteOriginContract = oc.errors(commonErrors).output(z.object({ origin: z.string() }));

export const siteContract = {
  origin: siteOriginContract,
};
