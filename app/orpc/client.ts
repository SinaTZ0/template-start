import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContractClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import type { contract } from "~/orpc/contract";

/*===== Browser Client =====*/
// Typed from the contract only, so no server code reaches the bundle. The link resolves `/rpc`
// against the current origin, so call it from the browser only; loaders use the server client.
const link = new RPCLink({ url: "/rpc" });

export const client: RouterContractClient<typeof contract> = createORPCClient(link);

/*===== TanStack Query =====*/
/** Query and mutation option builders for every procedure, e.g. `orpc.note.list.queryOptions()`. */
export const orpc = createTanstackQueryUtils(client);
