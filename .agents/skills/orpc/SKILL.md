---
name: orpc
description: Build typesafe APIs with oRPC v2 (beta) — contracts, implementers, procedures, routers, middleware, context, typesafe errors, metadata, RPC handler/link, server-side clients, TanStack Query utilities, plugins, and helpers. Use when adding or changing anything under `src/orpc/`, mounting the RPC handler in TanStack Start, calling procedures from route loaders or the browser, or when code imports from `@orpc/*`.
license: MIT
---

# oRPC (v2 beta)

This project uses **oRPC v2 beta** (`@orpc/*@beta`). npm's `latest` tag is still v1, and most examples online
(and most model training data) are v1. v1 code often still compiles through deprecated aliases but behaves
differently, so never write oRPC code from memory: check it against the v2 docs and the installed types.

## This Project

oRPC is the API's edge here, not where its logic lives. Read this before any example below or on orpc.dev:

- **Schemas are Effect Schema, never zod.** zod isn't installed, and `pnpm lint` refuses an import of it. A contract
  passes Effect Schema through `standardSchema` (`src/lib/schema.ts`), which makes it a Standard Schema with the app's
  messages: `.input(standardSchema(Schema.Struct({ id: Schema.String })))`. Contract schemas check structure only and
  never transform (oRPC runs a procedure's output through its schema); domain rules and normalizing are in the
  feature's `validation.ts`. An input field that may be `undefined` is `Schema.optional`. See
  `src/orpc/note/contract.ts`, and the shared error data and maps in `src/orpc/errors.ts`.
- **Procedures are `effectProcedure`, not middleware.** Each one is
  `effectProcedure(base.<feature>.<procedure>, { access, run, errors })` (`src/orpc/effect.server.ts`): `run` returns
  an Effect, run on the app's runtime, and `effectProcedure` applies the rate limits, the captcha and the session
  check, provides `CurrentUser`, and maps tagged errors to contract errors. Don't add oRPC middleware for any of that,
  and don't write `.handler(async …)` by hand. See `src/orpc/note/procedure.ts`, and the `effect` skill for the code
  under it.
- **The one middleware** is `handleErrorsMiddleware` (`src/orpc/handle-errors.server.ts`), on `base`
  (`src/orpc/implementer.server.ts`): it turns contract validation failures into `INVALID_INPUT`. The router is
  assembled with the undecorated `implementer` (`src/orpc/router.ts`).

The library examples in `references/` and on orpc.dev use zod and middleware. They stay as documentation of oRPC's
API; translate them into the patterns above.

## Before Writing Code

1. **Read the project architecture.** `docs/backend-flow.md` gives the steps for adding a feature.
   `docs/backend/architecture.md` defines the contract-first `src/orpc/` layout, the Effect layers under it, error
   rules, and naming. `docs/frontend/architecture.md` defines how routes consume the API. Those docs win over generic
   oRPC examples. This skill covers the library API only.
2. **Check the installed version.** Read `version` in `node_modules/@orpc/server/package.json`. All `@orpc/*`
   packages must be on the same version; mixing betas breaks the wire format and types.
3. **Avoid v1 habits.** Read `references/v1-pitfalls.md` whenever you touch builders, middleware, errors, handlers,
   links, or plugins.
4. **Load the matching reference** from the table below, then fetch the specific doc page for anything it does not
   cover.

## Sources of Truth

In priority order:

1. **Installed types**: `node_modules/@orpc/<pkg>/dist/**/*.d.ts`. They are authoritative for the exact beta in use.
2. **v2 docs as raw markdown**: append `.md` to any docs URL, e.g. `https://orpc.dev/docs/procedure.md`.
   `references/docs-index.md` lists every page with a one-line summary; pick pages from it instead of guessing URLs.
   Pages contain `twoslash` blocks whose setup lines above `// ---cut---` are hidden context, not code to copy.
3. **Migration guide**: `https://orpc.dev/docs/migrations/from-v1.md` has a side-by-side v1/v2 comparison for every
   change.

Never use `v1.orpc.dev` or docs for `@orpc/*` versions below 2.

## Installing Packages

Always install with the `@beta` tag, or the registry resolves v1:

```sh
pnpm add @orpc/contract@beta @orpc/server@beta @orpc/client@beta
pnpm add @orpc/tanstack-query@beta @tanstack/react-query   # TanStack Query utilities
pnpm add @orpc/openapi@beta                                # only for OpenAPI handler/spec, or form-data helpers
```

oRPC v2 accepts any Standard Schema, which is how this project passes Effect Schema (`standardSchema` in
`src/lib/schema.ts`). Don't install `zod` or `@orpc/zod`.

## Skill References

| Reference                    | Use When                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `references/v2-api.md`       | Writing contracts, implementers, procedures, middleware, errors, metadata, clients |
| `references/tanstack-start.md` | Mounting the handler, the isomorphic client for loaders, browser mutations        |
| `references/v1-pitfalls.md`  | Any oRPC change; check generated or remembered code against it                     |
| `references/docs-index.md`   | Finding the right doc page for plugins, helpers, adapters, OpenAPI, streaming      |

## Task → Doc Pages

| Task                                   | Fetch                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| Contract / implementer                 | `contract/procedure.md`, `contract/router.md`, `contract/implementation.md`            |
| Middleware, context, dedupe            | `middleware.md`, `context.md`, `recipes/dedupe-middleware.md`                          |
| Errors (server and client)             | `error-handling.md`, `client/error-handling.md`, `recipes/validation-customization.md` |
| Handler options, methods, status codes | `rpc/handler.md`                                                                       |
| Browser link options                   | `rpc/link.md`, `client/client-side.md`                                                 |
| Calling procedures on the server       | `client/server-side.md`, `recipes/optimizing-ssr.md`                                   |
| TanStack Query                         | `integrations/tanstack-query.md`                                                       |
| Cookies, headers                       | `helpers/cookie.md`, `plugins/request-headers.md`, `plugins/response-headers.md`       |
| Forms (bracket notation, issue text)   | `helpers/form-data.md`                                                                 |
| Validation tuning                      | `recipes/validation-customization.md`                                                  |
| Testing and mocking                    | `recipes/testing-and-mocking.md`, `integrations/msw.md`                                |
| Streaming (SSE)                        | `async-iterator-object.md`, `client/async-iterator-object.md`                          |
| Slow type checking                     | `contract/client-factory.md`, `recipes/exceeds-the-maximum-length-problem.md`          |

All paths are relative to `https://orpc.dev/docs/`.

## Verify

After changing oRPC code, run `pnpm typecheck`. Contract/implementer mismatches, missing router keys, and
undeclared errors surface there, not at runtime. Then run `pnpm lint`.
