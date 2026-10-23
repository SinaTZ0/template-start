import { SITE_ORIGIN } from "#/lib/site.server";
import { base } from "#/orpc/implementer.server";

/*===== Origin =====*/
// No service: it hands out a value from the environment, with no rules to apply.
export const siteOriginProcedure = base.site.origin.handler(() => ({ origin: SITE_ORIGIN }));
