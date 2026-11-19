import { oc } from "@orpc/contract";
import { Schema } from "effect";

import { standardSchema } from "#/lib/schema";
import { commonErrors } from "#/orpc/errors";

/*===== Procedures =====*/
/** The public origin, e.g. `https://example.com`, for the absolute URLs in head tags (`absoluteUrl` in `src/lib/seo.ts`). */
export const siteOriginContract = oc
  .errors(commonErrors)
  .output(standardSchema(Schema.Struct({ origin: Schema.String })));

export const siteContract = {
  origin: siteOriginContract,
};
