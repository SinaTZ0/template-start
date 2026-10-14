# oRPC in React Router Framework Mode

The project is React Router v8 in Framework Mode with SSR. Read `docs/frontend-guideline.md` for the route-side
rules. Upstream page: `https://orpc.dev/docs/adapters/react-router.md`.

## Mounting the Handler

A single splat resource route mounts the RPC handler. The handler itself lives in `app/orpc/handler.server.ts`; the
route only adapts React Router's `request` to it.

```ts
// app/routes.ts
route("rpc/*", "routes/rpc/rpc.ts"),
```

```ts
// app/routes/rpc/rpc.ts — resource route: no default export, so React Router returns the Response as-is
import type { Route } from "./+types/rpc";

import { rpcHandler } from "~/orpc/handler.server";

/**
 * Hands the request to oRPC; anything outside `/rpc/*` procedures is a 404.
 */
async function handleRequest(request: Request) {
  const { response } = await rpcHandler.handle(request, {
    prefix: "/rpc", // must match the route path and the browser link's `url`
    context: { headers: request.headers }, // initial context; may be an async function
  });
  return response ?? new Response("Not found", { status: 404 });
}

export async function loader({ request }: Route.LoaderArgs) {
  return handleRequest(request);
}

export async function action({ request }: Route.ActionArgs) {
  return handleRequest(request);
}
```

- React Router sends GET/HEAD to `loader` and other methods to `action`. The RPC handler rejects GET by default, so
  the `loader` only matters if `allowMethods` adds GET (or for an OpenAPI handler). Keep it so those requests get a
  proper oRPC response instead of a React Router 405.

## Render-Critical Data in Loaders

Loaders run on the server, so call procedures in-process instead of fetching your own `/rpc` endpoint. Create the
client **per request** so request-scoped context (headers, user) never leaks between requests:

```ts
// e.g. app/orpc/server-client.server.ts
import { createRouterClient } from "@orpc/server";

import { router } from "~/orpc/router";

/**
 * In-process client for loaders and actions. Bypasses HTTP, so handler plugins and `errorStatusMap` do not run.
 */
export function createServerClient(request: Request) {
  return createRouterClient(router, { context: { headers: request.headers } });
}
```

```ts
export async function loader({ request, params }: Route.LoaderArgs) {
  const client = createServerClient(request);
  return { planet: await client.planet.find({ id: params.id }) };
}
```

Consequences of bypassing the handler:

- **Errors are thrown as `ORPCError`**, not turned into HTTP responses. Translate the ones the page cares about,
  e.g. `NOT_FOUND` into `throw data(null, { status: 404 })` so the route's `ErrorBoundary` renders; let unexpected
  ones propagate.
- **Handler plugins do not run.** `context.reqHeaders` / `context.resHeaders` are `undefined` unless you pass them in
  the context yourself. If a procedure sets cookies through `resHeaders`, pass a `new Headers()` in, then forward it
  with `data(result, { headers })` from the loader or action.
- Any middleware applied only in the handler path (handler-level interceptors) is skipped; middleware applied in the
  implementer still runs.

## Browser Interactions

- Submitting, refreshing, and polling go through the contract-typed client in `app/orpc/client.ts` and its TanStack
  Query utilities. Never hand-write `fetch` calls to `/rpc`.
- The browser `RPCLink` uses `url: "/rpc"` with no `origin`; it resolves against `window.location`. Do not call this
  client during SSR, because render-critical data belongs in the loader.
- With TanStack Query, a `QueryClientProvider` goes in `app/root.tsx`. If loader data seeds the cache, use
  `queryClient.setQueryData(orpc.x.queryKey({ input }), loaderData.x)` or hydration; keep `staleTime > 0` so the
  query does not refetch immediately on mount.
- Forms: show the server's per-field messages from typed errors (`isDefinedError` / `safe`) next to their fields.

## Server/Client Boundary

React Router fails the build when a `*.server.ts` module reaches client code. Keep the implementer, router, handler,
services, and repositories server-only; components may import only contracts, `constants.ts`, `*.errors.ts`, and the
browser client. Type-only imports (`import type`) are erased and safe.
