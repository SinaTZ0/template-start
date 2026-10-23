import { createFileRoute } from "@tanstack/react-router";

import { rpcHandler } from "#/orpc/handler.server";

/*===== RPC Endpoint =====*/
/**
 * Hands the request to oRPC. Anything that isn't a known procedure is a 404.
 */
async function handleRequest({ request }: { request: Request }) {
  const { response } = await rpcHandler.handle(request, {
    // Must match this route's path and the browser link's `url` (`#/orpc/client`).
    prefix: "/rpc",
    context: { headers: request.headers },
  });
  return response ?? new Response("Not found", { status: 404 });
}

/*===== Route =====*/
// Every method goes to oRPC, which rejects all but POST with a proper oRPC response.
export const Route = createFileRoute("/rpc/$")({
  server: { handlers: { ANY: handleRequest } },
});
