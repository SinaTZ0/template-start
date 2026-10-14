import { implement } from "@orpc/server";

import { contract } from "~/orpc/contract";
import { handleErrorsMiddleware } from "~/orpc/middleware/handle-errors/handle-errors.middleware";

/*===== Implementer =====*/
// Undecorated: only assembles the router (`router.ts`). Declares the initial context every
// caller (RPC handler, server client) must provide.
export const implementer = implement(contract).$context<{ headers: Headers }>();

/*===== Base =====*/
// Every procedure is built from `base`, so global middleware wraps contract validation exactly
// once. Never assemble the router from `base`: v2 doesn't dedupe, so it would run twice.
export const base = implementer.use(handleErrorsMiddleware);
