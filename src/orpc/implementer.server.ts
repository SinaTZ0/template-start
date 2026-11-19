import { implement } from "@orpc/server";

import { contract } from "#/orpc/contract";
import { handleErrorsMiddleware } from "#/orpc/handle-errors.server";

/*===== Implementer =====*/
// Undecorated: only assembles the router (`router.ts`). Declares the initial context every
// caller (RPC handler, server client) must provide.
export const implementer = implement(contract).$context<{ headers: Headers }>();

/*===== Base =====*/
// Every procedure is built from `base` and implemented with `effectProcedure` (`#/orpc/effect.server`), which applies
// the rate limits, the captcha, access and error mapping. The one middleware left normalizes the errors oRPC raises
// itself, around contract validation, before any handler runs. Never assemble the router from `base`: v2 doesn't
// dedupe, so it would run twice.
export const base = implementer.use(handleErrorsMiddleware);
