import { createFileRoute } from "@tanstack/react-router";

import { rpcHandlerFor } from "#/orpc/handler.server";

/*===== RPC Endpoint =====*/
/**
 * Hands the request to oRPC. Anything that isn't a known procedure is a 404.
 */
async function handleRequest({ request }: { request: Request }) {
  const { response } = await rpcHandlerFor(new URL(request.url).pathname).handle(request, {
    // Must match this route's path and the browser link's `url` (`#/orpc/client`).
    prefix: "/rpc",
    context: { headers: request.headers },
  });
  return response ?? new Response("Not found", { status: 404 });
}

/*===== Route =====*/
// Every method goes to oRPC, which matches procedures on POST only: anything else gets the 404 above.
export const Route = createFileRoute("/rpc/$")({
  server: { handlers: { ANY: handleRequest } },
});
