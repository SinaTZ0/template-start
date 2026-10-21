import { ORPCError } from "@orpc/server";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { createMiddleware, createStart } from "@tanstack/react-start";

import { createLogger } from "~/lib/logger.server";
import { span } from "~/lib/trace.server";

const log = createLogger("server-fn");

/*===== Server Functions =====*/
/**
 * Runs around every server function:
 *
 * - Times it as a `server-fn` span (`app/lib/trace.server.ts`), so the request log shows how long loaders spent on the
 *   server. Procedures and queries it starts become its children in the timeline.
 * - Logs a failure, which also reports it to the error viewer (docs/backend/logging.md). Redirects and not-found are
 *   control flow, and an oRPC error with an `errorId` was already logged by the global oRPC middleware.
 */
const serverFunctionMiddleware = createMiddleware({ type: "function" }).server(async ({ next, serverFnMeta }) => {
  try {
    return await span({ kind: "server-fn", name: serverFnMeta.name }, () => next());
  } catch (error) {
    if (!isRedirect(error) && !isNotFound(error) && !hasErrorId(error)) {
      log.error({ err: error, serverFn: serverFnMeta.name }, "server function failed");
    }
    throw error;
  }
});

function hasErrorId(error: unknown): boolean {
  return error instanceof ORPCError && typeof (error.data as { errorId?: unknown } | undefined)?.errorId === "string";
}

/*===== Start =====*/
export const startInstance = createStart(() => ({
  functionMiddleware: [serverFunctionMiddleware],
}));
