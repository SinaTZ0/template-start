import { implement } from "@orpc/server";

import { contract } from "#/orpc/contract";
import { handleErrorsMiddleware } from "#/orpc/middleware/handle-errors/handle-errors.middleware";
import { rateLimitMiddleware } from "#/orpc/middleware/rate-limit/rate-limit.middleware";
import { traceProcedureMiddleware } from "#/orpc/middleware/trace/trace.middleware";

/*===== Implementer =====*/
// Undecorated: only assembles the router (`router.ts`). Declares the initial context every
// caller (RPC handler, server client) must provide.
export const implementer = implement(contract).$context<{ headers: Headers }>();

/*===== Base =====*/
// Generous on purpose: many Iranian mobile users share one carrier address (CGNAT), and a page's loaders count too.
// Expensive procedures add their own, stricter policy.
const API_RATE_LIMIT = { name: "api", limit: 300, windowMs: 60_000 };

// Every procedure is built from `base`, so global middleware wraps contract validation exactly
// once. Never assemble the router from `base`: v2 doesn't dedupe, so it would run twice. Tracing goes first so its
// span includes the error handling; the rate limit runs inside it, so a rejection is logged as a client error.
export const base = implementer
  .use(traceProcedureMiddleware)
  .use(handleErrorsMiddleware)
  .use(rateLimitMiddleware(API_RATE_LIMIT));
