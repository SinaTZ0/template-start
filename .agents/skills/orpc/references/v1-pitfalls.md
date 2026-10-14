# v1 Habits That Break or Misbehave in v2

Many v1 names still compile through deprecated aliases (shown with a strike-through in the editor), so a clean
typecheck does not prove v2-correct code. Treat any strike-through `@orpc/*` symbol as a bug. Full comparison:
`https://orpc.dev/docs/migrations/from-v1.md`.

## Silent Behavior Changes

These compile but behave differently:

| v1 assumption                                             | v2 reality                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Router-level middleware already on a procedure is skipped | No automatic dedupe: it **runs twice**. Apply once or guard with a context flag.                       |
| `filter: ({ contract, path }) => ...`                     | Positional `filter: (contract, path) => ...`; the destructured form type-checks but reads garbage.     |
| RPC handler accepts GET for `GET`-routed procedures       | GET is rejected by default (`allowMethods`); allowing it needs `GetMethodCsrfProtectionHandlerPlugin`. |
| `CORSPlugin` reflects the request origin                  | `CORSHandlerPlugin` defaults to `*`, which breaks credentialed requests. Set `origin` explicitly.      |
| `.input()` / `.output()` replaces the previous schema     | Each call **adds** a schema (inputs merge, outputs pipe).                                              |
| `.prefix()` applies only to procedures with a `path`      | `openapi({ prefix })` applies to every procedure.                                                      |
| Batch Plugin `exclude`                                    | Replaced by `filter` with the **opposite** meaning.                                                    |
| `RegExp` serializes natively                              | Serializes as `{}` unless you register a serializer handler.                                           |
| `safe()` third element is a boolean                       | Third element is the typed error or `null`; fourth is `isSuccess`.                                     |
| v1 client talks to v2 server                              | Wire format changed; server and client must be upgraded together.                                      |

## Removed or Renamed APIs

| v1                                                                                                                     | v2                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `.route({...})`, `.prefix()`, `.tag()`, `.$route()`                                                                    | `.meta(openapi({ method, path, prefix, tags }))` from `@orpc/openapi`                           |
| `.$meta<T>()`, `procedure['~orpc'].meta`                                                                               | `defineMeta(name, merge)` → `[metaPlugin, getMeta]`                                             |
| `.callable({...})`                                                                                                     | `call(proc, input, opts)` / `createRouterClient` (or import `@orpc/server/extensions/callable`) |
| `.actionable()`                                                                                                        | `@orpc/next` server functions (not used in this project)                                        |
| `mw.concat(other)`                                                                                                     | `mw.use(other)`                                                                                 |
| `mw.mapInput(fn)`, `.use(mw, mapInput)`                                                                                | `.use(mw.adaptInput(fn))`                                                                       |
| middleware 3rd arg `output(value)`                                                                                     | `done({ output: value })`                                                                       |
| `.$input`                                                                                                              | removed; stack `.input()` calls                                                                 |
| `.$config({ initialInputValidationIndex, ... })`, `dedupeLeadingMiddlewares`                                           | `.$config({ disableInputValidation, disableOutputValidation })`                                 |
| `ORPCError(code, { status })`, `.errors({ X: { status } })`                                                            | no `status`; use handler `errorStatusMap`                                                       |
| `rootInterceptors`                                                                                                     | `routingInterceptors`                                                                           |
| `adapterInterceptors`                                                                                                  | removed; use `interceptors`                                                                     |
| `customJsonSerializers: [{ type: 21, ... }]`                                                                           | `serializer: new RPCSerializer({ handlers: { name: {...} } })`                                  |
| flat `eventIteratorKeepAlive*` handler options                                                                         | `toFetchResponse: { eventStream: { keepAlive: {...} } }` (15s default)                          |
| `StrictGetMethodPlugin`, `SimpleCsrfProtection*Plugin`                                                                 | `allowMethods` + `GetMethodCsrfProtectionHandlerPlugin`                                         |
| `CORSPlugin`, `RequestHeadersPlugin`, `ResponseHeadersPlugin`                                                          | `CORSHandlerPlugin`, `RequestHeadersHandlerPlugin`, `ResponseHeadersHandlerPlugin`              |
| `BodyLimitPlugin`, `CompressionPlugin`                                                                                 | `RequestLimitHandlerPlugin`; `Request`/`ResponseCompressionHandlerPlugin`                       |
| `new RPCLink({ url: "http://host/rpc" })`                                                                              | `new RPCLink({ origin: "http://host", url: "/rpc" })` (omit `origin` in the browser)            |
| custom link `fetch(request, init)`                                                                                     | `fetch(url: string, init, options)`                                                             |
| `clientInterceptors` (link)                                                                                            | `transportInterceptors`                                                                         |
| `ContractRouterClient`, `InferContractRouter*`, `minifyContractRouter`                                                 | `RouterContractClient`, `InferRouterContract*`, `minifyRouterContract`                          |
| `RequestValidationPlugin` / `ResponseValidationPlugin`                                                                 | `RequestValidationLinkPlugin` / `ResponseValidationLinkPlugin`                                  |
| `eventIterator(...)`, `EventPublisher`                                                                                 | `asyncIteratorObject(...)`, `MemoryPublisher` (`publish` is async)                              |
| `@orpc/react-query` etc.                                                                                               | `@orpc/tanstack-query`                                                                          |
| TanStack utils `{ path: [...] }`, `experimental_streamedOptions` / `experimental_liveOptions`, `experimental_defaults` | `{ prefix }`, `streamedOptions` / `liveOptions`, `scoped`                                       |
| `@orpc/openapi-client`                                                                                                 | merged into `@orpc/openapi`                                                                     |
| `@orpc/zod` with Zod v3                                                                                                | Zod v4 only                                                                                     |
