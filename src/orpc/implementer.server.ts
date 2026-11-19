import { implement } from "@orpc/server";

import { contract } from "#/orpc/contract";
import { handleErrorsMiddleware } from "#/orpc/handle-errors.server";
import type { AppRuntime } from "#/server/runtime.server";

/*===== Implementer =====*/
// Undecorated: only assembles the router (`router.ts`). Declares the initial context every caller (RPC handler, server
// client) must provide: the request's headers, and, in tests only, the runtime the procedures run on in place of the
// app's (`#/server/runtime.server`).
export const implementer = implement(contract).$context<{ headers: Headers; runtime?: AppRuntime }>();

/*===== Base =====*/
// Every procedure is built from `base` and implemented with `effectProcedure` (`#/orpc/effect.server`), which applies
// the rate limits, the captcha, access and error mapping. The one middleware left normalizes the errors oRPC raises
// itself, around contract validation, before any handler runs. Never assemble the router from `base`: v2 doesn't
// dedupe, so it would run twice.
export const base = implementer.use(handleErrorsMiddleware);
