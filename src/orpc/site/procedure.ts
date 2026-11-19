import { Effect } from "effect";

import { effectProcedure } from "#/orpc/effect.server";
import { base } from "#/orpc/implementer.server";
import { AppConfig } from "#/server/config.server";

/*===== Origin =====*/
// No service: the procedure only hands out a value from the configuration. Add one once the feature gets a rule.
export const siteOriginProcedure = effectProcedure(base.site.origin, {
  run: () => AppConfig.use(({ siteUrl }) => Effect.succeed({ origin: siteUrl.origin })),
  errors: {},
});
