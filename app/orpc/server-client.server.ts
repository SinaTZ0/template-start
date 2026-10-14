import { createRouterClient } from "@orpc/server";

import { router } from "~/orpc/router";

/*===== Server Client =====*/
/**
 * In-process API client for loaders and actions, created per request so request context never
 * leaks between users.
 *
 * Bypasses HTTP: handler plugins and status codes don't apply, and errors arrive as `ORPCError`.
 */
export function createServerClient(request: Request) {
  return createRouterClient(router, { context: { headers: request.headers } });
}
