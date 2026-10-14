---
name: orpc
description: Build typesafe APIs with oRPC v2 (beta) — contracts, implementers, procedures, routers, middleware, context, typesafe errors, metadata, RPC handler/link, server-side clients, TanStack Query utilities, plugins, and helpers. Use when adding or changing anything under `app/orpc/`, mounting the RPC handler in React Router, calling procedures from loaders/actions or the browser, or when code imports from `@orpc/*`.
license: MIT
---

# oRPC (v2 beta)

This project uses **oRPC v2 beta** (`@orpc/*@beta`). npm's `latest` tag is still v1, and most examples online
(and most model training data) are v1. v1 code often still compiles through deprecated aliases but behaves
differently, so never write oRPC code from memory: check it against the v2 docs and the installed types.

## Before Writing Code

1. **Read the project architecture.** `docs/backend-flow.md` gives the steps for adding a feature.
   `docs/backend/architecture.md` defines the contract-first `app/orpc/` layout, layers, error rules, middleware
   placement, and naming. `docs/frontend/architecture.md` defines how routes consume the API. Those docs win over
   generic oRPC examples. This skill covers the library API only.
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

Always install with the `@beta` tag, or npm resolves v1:

```sh
npm install @orpc/contract@beta @orpc/server@beta @orpc/client@beta
npm install @orpc/tanstack-query@beta @tanstack/react-query   # TanStack Query utilities
npm install @orpc/openapi@beta                                # only for OpenAPI handler/spec, or form-data helpers
```

Zod is already a dependency. oRPC v2 accepts Zod v4 schemas directly through Standard Schema; `@orpc/zod` is only
needed for JSON Schema conversion (OpenAPI generation, Smart Coercion).

## Skill References

| Reference                    | Use When                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `references/v2-api.md`       | Writing contracts, implementers, procedures, middleware, errors, metadata, clients |
| `references/react-router.md` | Mounting the handler, calling procedures from loaders/actions, browser client      |
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

After changing oRPC code, run `npm run typecheck`. Contract/implementer mismatches, missing router keys, and
undeclared errors surface there, not at runtime. Then run `npm run lint`.
