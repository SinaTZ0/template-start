# oRPC in TanStack Start

The project is TanStack Start with SSR, and TanStack Query is its data cache. Read `docs/frontend/data-loading.md` for
the route-side rules. Upstream page: `https://orpc.dev/docs/adapters/tanstack-start.md`.

## Mounting the Handler

A catch-all server route mounts the RPC handler. The handler itself lives in `app/orpc/handler.server.ts`; the route
only adapts Start's `request` to it.

```ts
// app/routes.ts (virtual file routes)
route("/rpc/$", "rpc/rpc.ts"),
```

```ts
// app/routes/rpc/rpc.ts: a server route, no component
import { createFileRoute } from "@tanstack/react-router";

import { rpcHandler } from "~/orpc/handler.server";

async function handleRequest({ request }: { request: Request }) {
  const { response } = await rpcHandler.handle(request, {
    prefix: "/rpc", // must match the route path and the browser link's `url`
    context: { headers: request.headers }, // initial context; may be an async function
  });
  return response ?? new Response("Not found", { status: 404 });
}

export const Route = createFileRoute("/rpc/$")({
  server: { handlers: { ANY: handleRequest } },
});
```

- `ANY` sends every method to oRPC. The RPC handler accepts POST only by default, and answers the rest with a proper
  oRPC error.

## One Client for Loaders and the Browser

Route loaders are isomorphic, so the client is too (`app/orpc/client.ts`):

```ts
const getClient = createIsomorphicFn()
  .server(
    (): RouterContractClient<typeof contract> =>
      createRouterClient(router, { context: () => ({ headers: getRequestHeaders() }) }),
  )
  .client((): RouterContractClient<typeof contract> => createORPCClient(new RPCLink({ url: "/rpc" })));

export const client = getClient();
export const orpc = createTanstackQueryUtils(client);
```

- **Server branch:** calls procedures in-process during SSR and in server functions. The instance is created once
  and shared by every request, so the context is a **function**: each call reads its own request's headers through
  `getRequestHeaders()`. Never put request data in a plain context object here.
- **Browser branch:** `RPCLink` over HTTP, resolved against `window.location`.
- Start's compiler drops the `.server()` branch from the client bundle, and with it the router and all server code.
- Loaders and components use the same options: `ensureQueryData(orpc.note.list.queryOptions())` in the loader,
  `useSuspenseQuery(orpc.note.list.queryOptions())` in the component. The SSR Query integration sends the server's
  cache to the browser, so hydration doesn't call the procedure again.

Consequences of the in-process server branch:

- **Errors are thrown as `ORPCError`**, not turned into HTTP responses. Translate the ones the page cares about, e.g.
  `NOT_FOUND` into `throw notFound()` so the route's `notFoundComponent` renders; let unexpected ones propagate to the
  `errorComponent`.
- **Handler plugins don't run.** `context.reqHeaders` / `context.resHeaders` are `undefined` unless passed in. A
  procedure that sets cookies must be called over HTTP (from the browser) or set them through Start's `setCookie`.
- Middleware applied only in the handler path (handler-level interceptors) is skipped; middleware applied in the
  implementer still runs.

## Browser Interactions

- Mutations use `useMutation(orpc.<feature>.<procedure>.mutationOptions())` and then invalidate the keys they change:
  `queryClient.invalidateQueries({ queryKey: orpc.note.list.key() })`. Never hand-write `fetch` calls to `/rpc`.
- The `QueryClient` is created in `getRouter()` (`app/router.tsx`) and provided by the SSR Query integration; don't
  add another `QueryClientProvider`.
- Forms: show the server's per-field messages from typed errors (`isDefinedError` / `safe`) next to their fields.

## Server/Client Boundary

Start's import protection fails the build when browser-reachable code imports a `*.server.ts` module outside a server
function's handler or an isomorphic function's `.server()` branch. Keep the implementer, router, handler, services,
and repositories server-only; components may import only contracts, `constants.ts`, `*.errors.ts`, and
`app/orpc/client.ts`. Type-only imports (`import type`) are erased and safe.
