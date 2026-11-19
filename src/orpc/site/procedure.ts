import { Effect } from "effect";

import { SITE_ORIGIN } from "#/lib/site.server";
import { effectProcedure } from "#/orpc/effect.server";
import { base } from "#/orpc/implementer.server";

/*===== Origin =====*/
// No service: the procedure only hands out a value from the configuration. Add one once the feature gets a rule.
export const siteOriginProcedure = effectProcedure(base.site.origin, {
  run: () => Effect.succeed({ origin: SITE_ORIGIN }),
  errors: {},
});
