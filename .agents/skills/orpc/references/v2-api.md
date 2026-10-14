# oRPC v2 API Cheat Sheet

Verified against the v2 docs (`2.0.0-beta`). Where this file and the installed `.d.ts` disagree, the types win.
File names and layering follow `docs/backend-guideline.md`; that guideline wins on architecture, this file on API usage.

## Contract (`@orpc/contract`, browser-safe)

```ts
import { oc } from "@orpc/contract";
import { z } from "zod";

export const findPlanetContract = oc
  .errors({ NOT_FOUND: { message: "Planet not found" } }) // every error the procedure may throw
  .input(z.strictObject({ id: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() })); // without .output the client sees `unknown`

export const planetContract = { find: findPlanetContract };
export const contract = { planet: planetContract }; // root contract is a plain object
```

- `.input` / `.output` **stack**: each call adds a schema. Object inputs merge (two levels deep), outputs are piped
  in reverse order. Stacked outputs need `z.looseObject`; `z.strictObject` cannot be stacked.
- `oc.meta(...).router({...})` applies shared config to every contract in a router.
- Forbidden router keys: `then`, `bind`, `call`, `apply`, `valueOf`, `toString`, `toJSON`.
- Type utilities: `InferRouterContractInputs`, `InferRouterContractOutputs`, `InferRouterContractErrors`,
  `InferRouterContractError` (all from `@orpc/contract`).

## Implementer (`@orpc/server`, server-only)

```ts
// implementer.server.ts
import { implement } from "@orpc/server";

// Undecorated: only assembles the router. Initial context is declared here.
export const implementer = implement(contract).$context<{ headers: Headers }>();
// optional config: implement(contract, { disableOutputValidation: true }) or .$config({...})

// Decorated: every procedure is built from this, so global middleware wraps validation exactly once.
export const base = implementer.use(loggingMiddleware).use(errorMiddleware);
```

```ts
// <feature>/procedure.ts
export const findPlanetProcedure = base.planet.find
  .use(dbMiddleware) // feature middleware: after the procedure key, runs after input validation
  .handler(async ({ input, context, errors }) => {
    const planet = await findPlanet({ db: context.db, id: input.id });
    if (!planet) throw errors.NOT_FOUND({ data: { errors: {}, fields: {} } });
    return planet; // checked against the contract output
  });
```

```ts
// router.ts — assembled with the UNDECORATED implementer
export const router = implementer.router({ planet: { find: findPlanetProcedure } }); // missing keys fail to compile
```

- Never assemble the router with `base` (or `implementer.use(...).router(...)`) when procedures are already built
  from `base`: v2 has no automatic dedupe, so global middleware would run twice per call.
- Middleware that must wrap **validation** goes on the implementer or a sub-router (`implementer.use(mw)`,
  `implementer.planet.use(mw).find`), not after the procedure key.
- `implementer.middleware(...)` creates middleware that sees the contract's typed `errors`; guard with
  `'CODE' in errors` when not every contract declares it.

## Middleware

```ts
const dbMiddleware = os.$context<{ db?: Db }>().middleware(async ({ context, next }) => {
  if (context.db) return next(); // manual dedupe; v2 has no automatic dedupe
  return next({ context: { db: await getDb() } }); // injected context, merged at runtime
});
```

- Signature: `({ context, next, errors, path, procedure, ... }, input, done) => ...`.
- Short-circuit with `return done({ output })` (not v1's `output(value)`).
- Use `await next()` inside `try` so async errors are caught.
- Typed input: `os.middleware(async ({ next }, id: string) => ...)`, applied with `.use(mw.adaptInput(i => i.id))`.
- Combine: `mwA.use(mwB)` (v1's `.concat` is deprecated).
- Context passed to `next` must not conflict with existing context types.
- **Middleware applied at both router and procedure level runs twice.** Guard with a context flag (see above) or
  apply it in one place only.

## Context

- **Initial context**: declared with `.$context<T>()`, supplied by the caller (`handler.handle(req, { context })`,
  `createRouterClient(router, { context })`, `call(proc, input, { context })`).
- **Injected context**: added by middleware via `next({ context })`; callers never pass it.
- A global default type is possible through `declare module "@orpc/server" { interface DefaultInitialContext {...} }`.

## Errors

### Declaring errors (browser-safe)

```ts
// <feature>/<name>.errors.ts or middleware/<name>/<name>.errors.ts — plain map, no `@orpc/server` import
import { errorDataSchema } from "~/orpc/errors"; // the shared `{ errors, fields }` shape

export const planetErrors = {
  NOT_FOUND: { message: "Planet not found", data: errorDataSchema },
};

// contract.ts
oc.errors({ ...commonErrors, ...planetErrors }).input(...).output(...);
```

- Do **not** use oRPC's `error()` factory in these files: it is exported from `@orpc/server`, so the browser bundle
  would pull in the server package. Plain maps work with `.errors()` and stay browser-safe.

### Throwing errors

```ts
throw errors.NOT_FOUND({ data: { errors: {}, fields: {} } }); // preferred: typed constructor from handler/middleware args
throw new ORPCError("UNAUTHORIZED", { message: "...", data: {...} }); // only where `errors` is not available
```

- A thrown error is a **declared** error only if its `code` is declared on the procedure **and** its `data` passes
  the declared schema. Otherwise the client receives an unknown error and loses its types. Always build `data` in
  the shared shape.
- `message` and `data` reach the client. Never put internals in them. There is no `status` option in v2.
- HTTP status is a **handler** concern: `new RPCHandler(router, { errorStatusMap: { ...COMMON_ERROR_STATUS_MAP, X: 422 } })`
  (`COMMON_ERROR_STATUS_MAP` from `@orpc/server`).
- Throw `Error` instances only (`recipes/no-throw-literal.md`).
- Restrict error codes project-wide via `declare module "@orpc/server" { interface Registry { ORPCErrorCode: ... } }`.

### Validation failures and the global error middleware

Schema failures do not arrive in the shared shape. They are `ORPCError`s whose `cause` is a `ValidationError`:

| Failure        | `code`                  | Handling                                                            |
| -------------- | ----------------------- | ------------------------------------------------------------------- |
| Invalid input  | `BAD_REQUEST`           | Convert to the declared invalid-input error with per-field messages |
| Invalid output | `INTERNAL_SERVER_ERROR` | Server bug: log it with an ID; expose no validation details         |

```ts
import { ORPCError, ValidationError } from "@orpc/server";

const errorMiddleware = os.middleware(async ({ next }) => {
  try {
    return await next(); // `await` is required, or async errors escape the catch
  } catch (error) {
    if (error instanceof ORPCError && error.cause instanceof ValidationError) {
      if (error.code === "BAD_REQUEST") {
        // map error.cause.issues (Standard Schema issues, `path` + `message`) into the shared data shape
        throw new ORPCError("INVALID_INPUT", { data: toErrorData(error.cause.issues), cause: error });
      }
      // output validation failure: fall through to the generic 5xx handling below
    }
    // ...normalize everything else (5xx: log with a correlation ID, hide the message)
    throw error;
  }
});
```

Only middleware applied **before** validation (on the implementer) sees these errors. The converted error must be
declared on every contract (e.g. via the shared common errors) to stay typed. More: `recipes/validation-customization.md`.

### Failures before the procedure runs

Errors raised by the handler itself, such as a request body that cannot be decoded, happen before any middleware
runs. Log them with a handler interceptor in `handler.server.ts` (e.g. `interceptors: [onError(...)]`).

## Metadata

```ts
import { defineMeta } from "@orpc/server";

const [cacheMeta, getCacheMeta] = defineMeta("cache", (incoming: boolean) => incoming);
// attach: oc.meta(cacheMeta(true)) / os.meta(...)
// read in middleware: getCacheMeta(procedure)
```

v1's `.$meta<T>()` and reading `procedure['~orpc'].meta` are gone. OpenAPI routing is also metadata now:
`.meta(openapi({ method: "GET", path: "/planets" }))` from `@orpc/openapi`.

## RPC Handler (`@orpc/server/fetch`)

```ts
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RequestHeadersHandlerPlugin, ResponseHeadersHandlerPlugin } from "@orpc/server/plugins";

export const rpcHandler = new RPCHandler(router, {
  plugins: [new RequestHeadersHandlerPlugin(), new ResponseHeadersHandlerPlugin()],
  interceptors: [onError((error) => console.error(error))],
  // allowMethods defaults to POST/PUT/PATCH/DELETE; GET is rejected unless allowed (add CSRF plugin if you do)
});

const { matched, response } = await rpcHandler.handle(request, {
  prefix: "/rpc",
  context: { headers: request.headers },
});
```

- Interceptor options: `interceptors`, `routingInterceptors` (v1 `rootInterceptors`); `filter: (contract, path) => ...`
  takes **positional** args.
- Plugin names end in `HandlerPlugin` (`CORSHandlerPlugin`, `RequestLimitHandlerPlugin`, ...), imported from
  `@orpc/server/plugins`.
- `context.reqHeaders` / `context.resHeaders` (from the headers plugins) are `undefined` when a procedure is called
  without the handler, so treat them as optional.

## Browser Client (`@orpc/client`)

```ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContractClient } from "@orpc/contract";

const link = new RPCLink({ url: "/rpc" }); // `url` is a path; `origin` defaults to the current origin in the browser
export const client: RouterContractClient<typeof contract> = createORPCClient(link);
```

- Typed from the **contract** (`RouterContractClient`), never from the router, so server code stays out of the bundle.
- Link options: `transportInterceptors` (v1 `clientInterceptors`); a custom `fetch(url, init, options)` receives a URL
  **string**.
- Client context: `RouterContractClient<typeof contract, { token?: string }>`, passed per call as
  `client.x(input, { context })`.

### Client errors

```ts
import { isDefinedError, safe } from "@orpc/client";

const { error, data, definedError, isSuccess } = await safe(client.planet.find({ id }));
if (definedError) {
  // typed: definedError.code / definedError.data
}
```

`safe` returns `[error, data, definedError, isSuccess]` or the object form. `definedError` is the typed error or
`null` (in v1 the third element was a boolean). `createSafeClient(client)` wraps every call.

## Server-Side Calls (`@orpc/server`)

- `call(procedure, input, { context })` for one-off calls (tests, procedure-to-procedure).
- `createRouterClient(router, { context, interceptors })` for many calls; `context` may be an (async) function of the
  per-call client context.
- These skip the HTTP handler: no handler plugins, no `errorStatusMap`, no serialization. Errors arrive as
  `ORPCError` instances.

## TanStack Query (`@orpc/tanstack-query`)

```ts
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

export const orpc = createTanstackQueryUtils(client); // `prefix: "x"` to separate multiple utils (v1: `path`)

useQuery(orpc.planet.find.queryOptions({ input: { id } }));
useMutation(orpc.planet.create.mutationOptions({ onError: (e) => isDefinedError(e) && ... }));
queryClient.invalidateQueries({ queryKey: orpc.planet.key() });
```

Streamed and live variants are `.streamedOptions` / `.liveOptions` (no `experimental_` prefix). Use `skipToken` as
the input to disable a query.

## Helpers

- Cookies: `getCookie`, `setCookie`, `deleteCookie`, `sign`, `unsign` from `@orpc/server/helpers`, operating on
  `Headers` (pair them with `context.reqHeaders` / `context.resHeaders`).
- Forms: `parseFormData`, `getIssueMessage` from `@orpc/openapi/helpers` (bracket-notation field names).
