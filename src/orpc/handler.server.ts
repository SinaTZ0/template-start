import { COMMON_ERROR_STATUS_MAP, ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";

import { createLogger } from "#/lib/logger.server";
import { ERROR_STATUS_MAP } from "#/orpc/errors";
import { router } from "#/orpc/router";

const log = createLogger("orpc");

/*===== RPC Handler =====*/
/**
 * HTTP adapter for the API, mounted at `/rpc/*` (see `src/routes/rpc/`).
 *
 * Only POST is accepted (oRPC's default), so a cross-site navigation can't trigger a procedure with
 * the user's cookies.
 */
export const rpcHandler = new RPCHandler(router, {
  errorStatusMap: { ...COMMON_ERROR_STATUS_MAP, ...ERROR_STATUS_MAP },
  interceptors: [
    // Failures before the procedure runs (e.g. an undecodable body) never reach middleware, so they are logged here.
    // The interceptor sees every error, though: client errors are expected (debug level), and server errors the global
    // middleware already logged carry an `errorId`.
    onError((err) => {
      if (!(err instanceof ORPCError) || err.code !== "INTERNAL_SERVER_ERROR") {
        if (err instanceof ORPCError) return log.debug({ err }, "client error");
        return log.error({ err }, "handler error");
      }
      const errorId: unknown = (err.data as { errorId?: unknown } | undefined)?.errorId;
      if (typeof errorId !== "string") log.error({ err }, "handler error");
    }),
  ],
});
