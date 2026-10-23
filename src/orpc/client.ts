import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContractClient } from "@orpc/contract";
import { createRouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { LOCALE_HEADER } from "#/lib/locale";
import type { contract } from "#/orpc/contract";
import { router } from "#/orpc/router";
import { getLocale } from "#/paraglide/runtime";

/*===== Client =====*/
/**
 * One client for loaders and components, wherever they run (oRPC's TanStack Start adapter):
 *
 * - Server (SSR): calls procedures in-process, with the current request's headers as context, so
 *   the session cookie reaches `requireUserMiddleware`. It bypasses HTTP: handler plugins and status codes don't
 *   apply, and errors arrive as `ORPCError`. The context is a function, so each call reads its own request's headers.
 * - Browser: `RPCLink` over HTTP to `/rpc` (`src/routes/rpc/rpc.ts`). `/rpc` has no locale in its path, so each call
 *   names the page's locale in a header, and the procedure's messages come back in it (docs/frontend/i18n.md). On the
 *   server, in-process calls share the page request's locale.
 *
 * Start's compiler drops the `.server()` branch from the client bundle, and the router and its server code with it.
 */
const getClient = createIsomorphicFn()
  .server((): RouterContractClient<typeof contract> =>
    createRouterClient(router, { context: () => ({ headers: getRequestHeaders() }) }),
  )
  .client((): RouterContractClient<typeof contract> =>
    createORPCClient(new RPCLink({ url: "/rpc", headers: () => ({ [LOCALE_HEADER]: getLocale() }) })),
  );

export const client = getClient();

/*===== TanStack Query =====*/
/** Query and mutation option builders for every procedure, e.g. `orpc.note.list.queryOptions()`. */
export const orpc = createTanstackQueryUtils(client);
