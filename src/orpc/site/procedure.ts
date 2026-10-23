import { SITE_ORIGIN } from "#/lib/site.server";
import { base } from "#/orpc/implementer.server";

/*===== Origin =====*/
// No `service.ts`, although docs/backend/architecture.md lists one as required: the procedure only hands out a value
// from the environment, so a service would be an empty layer. Add one once the feature gets a rule to apply.
export const siteOriginProcedure = base.site.origin.handler(() => ({ origin: SITE_ORIGIN }));
