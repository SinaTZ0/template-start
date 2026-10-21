import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContractClient } from "@orpc/contract";
import { createRouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import type { contract } from "~/orpc/contract";
import { router } from "~/orpc/router";

/*===== Client =====*/
/**
 * One client for loaders and components, wherever they run (oRPC's TanStack Start adapter):
 *
 * - Server (SSR, server functions): calls procedures in-process, with the current request's headers as context, so
 *   the session cookie reaches `requireUserMiddleware`. It bypasses HTTP: handler plugins and status codes don't
 *   apply, and errors arrive as `ORPCError`. The context is a function, so each call reads its own request's headers.
 * - Browser: `RPCLink` over HTTP to `/rpc` (`app/routes/rpc/rpc.ts`).
 *
 * Start's compiler drops the `.server()` branch from the client bundle, and the router and its server code with it.
 */
const getClient = createIsomorphicFn()
  .server((): RouterContractClient<typeof contract> =>
    createRouterClient(router, { context: () => ({ headers: getRequestHeaders() }) }),
  )
  .client((): RouterContractClient<typeof contract> => createORPCClient(new RPCLink({ url: "/rpc" })));

export const client = getClient();

/*===== TanStack Query =====*/
/** Query and mutation option builders for every procedure, e.g. `orpc.note.list.queryOptions()`. */
export const orpc = createTanstackQueryUtils(client);
