---
name: effect
description: Write server code on Effect v4 (the `effect` package, 4.x) the way this project does — services and layers, typed errors, Effect.fn spans, Schema, the database, jobs, logging and tracing. Use before adding or changing anything under `src/server/`, a feature's `service.ts`, `repository.ts`, `errors.ts`, `jobs.server.ts` or `procedure.ts`, any test that uses `@effect/vitest`, or whenever code imports from `effect` or `@effect/*`.
license: MIT
---

# Effect (v4)

The backend is built on **Effect 4.x** (`effect`, pinned exactly in `package.json`). Most Effect examples online, and
most of what models remember, are **v3**, and v3 names either no longer exist or mean something else. Never write
Effect code from memory.

## Before Writing Code

1. **Read the installed docs, not the website.** `node_modules/effect/AGENTS.md` is the Effect team's own guide for
   agents, versioned with the installed package, and `node_modules/effect/ai-docs/src/**` holds its worked examples
   (services, errors, layers, running, schedules, SQL, observability, testing). When the docs and the source disagree,
   `node_modules/effect/src/<Module>.ts` wins.
2. **Read this project's rules.** `docs/backend/architecture.md` (layers as services, typed errors, the oRPC
   boundary) and `docs/backend/logging.md` (logs, spans, reporting) win over generic Effect examples.
3. **Run `pnpm typecheck`.** It runs the Effect-patched `tsc` from `@effect/tsgo`, which fails on v3 APIs, floating
   Effects, a bare `yield` in a generator, unhandled requirements, and on APIs marked `@stability unstable` outside
   `src/server/` (`tsconfig.json`).

## v3 Names That Are Wrong in v4

| v3 (don't)                                | v4 (do)                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `Context.Tag`, `Context.GenericTag`       | `class X extends Context.Service<X, { … }>()("app/…/X") {}`                  |
| `Effect.Service`                          | `Context.Service` plus a `static readonly layer = Layer.effect(X, …)`        |
| `Effect.catchAll`                         | `Effect.catch` (typed errors only); `Effect.catchCause` for the whole cause  |
| `Effect.either`, `Either`                 | `Effect.result`, `Result`                                                    |
| `Effect.fork`                             | `Effect.forkChild`, `Effect.forkScoped` or `Effect.forkDetach`               |
| `Layer.scoped`                            | `Layer.effect` (it removes `Scope` from the requirements itself)             |
| `Option.fromNullable`                     | `Option.fromNullishOr`                                                       |
| `@effect/schema`, `Schema.TaggedErrorClass` | `Schema` from `effect`; `Schema.TaggedError<X>()("X", { … })`              |
| `Schema.decodeUnknown` (as an Effect)     | `Schema.decodeUnknownEffect`; `Schema.decodeUnknownSync` outside Effect      |
| `@effect/platform`, `@effect/sql`, `@effect/rpc` | `effect/http`, `effect/sql`, … (now inside `effect`)                  |
| `@effect/opentelemetry` for export        | `effect/observability` (`Otlp`, `OtlpTracer`, `OtlpLogger`, `OtlpMetrics`)   |
| `Runtime.runPromise(runtime)`             | `ManagedRuntime.make(layer)` and `runtime.runPromise` / `runPromiseExit`     |

If a name isn't in the table and you aren't sure, grep `node_modules/effect/src/` for `export const <name>` before
using it.

## How This Project Writes Effect Code

- **Functions are `Effect.fn("Owner.method")`.** The name becomes the span and the stack frame, and the span name's
  shape (`NoteService.remove`, `NoteRepo.lockOwned`) is how the request timeline sorts it into a kind. Use
  `Effect.fnUntraced` only for small helpers that aren't worth a span. Pass extra behaviour as further arguments to
  `Effect.fn`, never with `.pipe` on its result.
- **Services and repositories are `Context.Service` classes** with a static `layer`, built with `Layer.effect` from
  their dependencies. Nothing reads a module-level singleton or `process.env`: configuration comes from `AppConfig`,
  secrets are `Redacted`.
- **Expected failures are `Schema.TaggedError` classes** in the feature's `errors.ts`, named for the fact
  (`NoteNotFound`), carrying facts, never user-facing text. Raise one with `return yield* new NoteNotFound({ id })`;
  the `return` tells TypeScript the generator ends there.
- **Everything else is a defect.** A failed query, an S3 or SMTP fault that isn't a product outcome, a bug: end the
  call in `Effect.orDie` (repositories always do). Defects are reported once, at the boundary, with an `errorId`.
- **No user-facing text below the boundary.** `service.ts`, `repository.ts`, `jobs.server.ts` and `src/server/**` never
  import `#/paraglide/messages`. The procedure's error map turns a tagged error into a contract error, and the text is
  rendered there, in the request's locale.
- **Only boundaries run Effects.** `Effect.runPromise*` / `runtime.runPromise*` appear only in the oRPC boundary
  (`src/orpc/effect.server.ts`), the server entry, the job worker, seeds and tests. Inside Effect code, compose with
  `yield*`.
- **Unstable modules are wrapped once.** `effect/sql`, `effect/persistence`, `effect/observability` and
  `ErrorReporter` are `@stability unstable` and may break in a minor release. Use them only inside `src/server/`; the
  rest of the code goes through that wrapper.

## Common Mistakes

- **`yield` without `*`** in `Effect.gen` / `Effect.fn` yields the Effect object itself. Always `yield*`.
- **A floating Effect** (`Effect.log("x")` as a statement) never runs. Yield it.
- **`Effect.catch` doesn't catch defects.** A thrown exception inside `Effect.sync` / `Effect.promise` is a defect;
  use `Effect.try` / `Effect.tryPromise` with a `catch` that builds a tagged error when the failure is expected.
- **Wrapping `Effect.gen` in a function that only returns it.** Use `Effect.fn` instead.
- **`Schema.optionalKey` in input schemas.** It means "the key may be missing", and it rejects a key present with
  `undefined`, which loaders and forms pass (`{ cursor: undefined }`), though JSON never shows it. Use
  `Schema.optional` for optional input fields; `optionalKey` only where `undefined` must be refused.
- **Reading `AsyncLocalStorage` inside a fiber.** Request facts reach Effect code through the `RequestContext`
  service, read once at the boundary.
