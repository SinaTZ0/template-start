# Backend Flow

Start here for any API work. Follow the steps in order for every new feature, skipping the ones it doesn't need. Each
step links to the doc that holds its rules. Read that doc when you reach the step.

| Doc                                                  | Covers                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| [backend/architecture.md](./backend/architecture.md) | Structure, layers, contracts, validation, errors, middleware, auth, naming |
| [backend/logging.md](./backend/logging.md)           | Writing logs, request timing, reading a slow request's timeline            |
| [backend/media.md](./backend/media.md)               | Image uploads, processing, storage and rendering                           |

The `note` feature (`app/orpc/note/`) is the worked example. Copy its shape.

## Define

1. **Contract**: write `contract.ts` with the input/output schemas and every error the procedure can throw (common,
   middleware and feature errors). Register it in the root `app/orpc/contract.ts`
   ([architecture.md](./backend/architecture.md) → Contract first, Errors are uniform and safe).
2. **Validation**: write the domain schemas in `validation.ts`. They check meaning (trimming, normalization, allowed
   values), not structure, which the contract already checks ([architecture.md](./backend/architecture.md) →
   Validation happens twice).

## Implement

3. **Repository**: if the feature stores data, add its tables to `app/db/schema.ts` and run `pnpm db:push`. Then write
   `repository.ts`, with one focused read or write per function.
4. **Service**: write the rules and orchestration in `service.ts`. It receives its dependencies through one object
   parameter and returns explicit outcomes instead of throwing ([architecture.md](./backend/architecture.md) →
   Services return outcomes, Explicit dependencies). Image uploads follow [media.md](./backend/media.md).
5. **Mapper**: add `mapper.ts` only if the stored and public shapes differ.
6. **Procedure**: in `procedure.ts`, attach the middleware it needs (`requireUserMiddleware` or
   `requireRoleMiddleware`, then `provideDbMiddleware`), call the service, and map each failure outcome to a declared
   contract error. Register it in `app/orpc/router.ts` ([architecture.md](./backend/architecture.md) → Middleware,
   Auth).
7. **HTTP specifics**: set status codes or method rules in `handler.server.ts`, only if the defaults don't fit.

## Check

8. **Logging**: log through `createLogger`, never `console`, and wrap slow work that isn't timed automatically in
   `span(...)` ([logging.md](./backend/logging.md)).
9. **Test**: add an `integration.test.ts` if the behavior is consequential: a success case and the failures that
   matter ([architecture.md](./backend/architecture.md) → Testing). Run `pnpm lint` and `pnpm typecheck`.
10. **Use it**: a page reads the procedure in its `loader` through `createServerClient(request)` or calls it from the
    browser through `orpc` in `app/orpc/client.ts`. Build that side with [frontend-flow.md](./frontend-flow.md).
