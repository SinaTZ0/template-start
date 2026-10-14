import { rpcHandler } from "~/orpc/handler.server";

import type { Route } from "./+types/rpc";

/*===== RPC Endpoint =====*/
/**
 * Hands the request to oRPC. Anything that isn't a known procedure is a 404.
 */
async function handleRequest(request: Request) {
  const { response } = await rpcHandler.handle(request, {
    // Must match this route's path and the browser link's `url` (`~/orpc/client`).
    prefix: "/rpc",
    context: { headers: request.headers },
  });
  return response ?? new Response("Not found", { status: 404 });
}

// React Router sends GET/HEAD to the loader. The handler rejects them with a proper oRPC response
// instead of a React Router 405.
export function loader({ request }: Route.LoaderArgs) {
  return handleRequest(request);
}

export function action({ request }: Route.ActionArgs) {
  return handleRequest(request);
}
