# Backend Flow

Start here for any API work. Follow the steps in order for every new feature, skipping the ones it doesn't need. Each
step links to the doc that holds its rules. Read that doc when you reach the step.

| Doc                                                  | Covers                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [backend/architecture.md](./backend/architecture.md) | Structure, layers, contracts, validation, errors, middleware, auth, database, naming |
| [backend/logging.md](./backend/logging.md)           | Writing logs, error reporting (error viewer), request timing, slow-request reports   |
| [backend/media.md](./backend/media.md)               | Image uploads, processing, storage and rendering                                     |
| [deployment.md](./deployment.md)                     | Production stack, deploying, migrations in production, health check, backups         |

The `note` feature (`app/orpc/note/`) is the worked example. Copy its shape.

## Define

1. **Contract**: write `contract.ts` with the input/output schemas and every error the procedure can throw: the common
   errors, those of the middleware it uses (`authErrors`, `roleErrors`) and its own, each with `errorDataSchema` as its
   data. Register it in the root `app/orpc/contract.ts` ([architecture.md](./backend/architecture.md) → Contract first,
   Errors are uniform and safe).
2. **Validation**: write the domain schemas in `validation.ts`. They check meaning (trimming, normalization, allowed
   values), not structure, which the contract already checks. Their messages are Persian, because they reach the user
   as field errors ([architecture.md](./backend/architecture.md) → Validation happens twice).

## Implement

3. **Database**: if the feature stores data, add its tables to `app/db/schema.ts` and run `pnpm db:push`. Before
   committing, generate the migration with `pnpm db:generate --name <what-changed>` and commit it
   ([architecture.md](./backend/architecture.md) → Database).
4. **Repository**: write `repository.ts`, with one focused read or write per function. Queries for a user's records
   filter by the owner ([architecture.md](./backend/architecture.md) → Auth).
5. **Service**: write the rules and orchestration in `service.ts`. It receives `db` and its inputs through one object
   parameter, parses with `validation.ts`, and returns explicit outcomes instead of throwing. `issuesToErrorData`
   (`app/lib/schema-issues.ts`) turns a failed parse into field messages ([architecture.md](./backend/architecture.md)
   → Services return outcomes, Explicit dependencies). Image uploads follow [media.md](./backend/media.md).
6. **Mapper**: add `mapper.ts` only if the stored and public shapes differ.
7. **Procedure**: in `procedure.ts`, start from `base.<feature>.<procedure>` (`implementer.server.ts`), attach the
   middleware it needs (`requireUserMiddleware` or `requireRoleMiddleware`, then `provideDbMiddleware`), call the
   service, and map each failure outcome to a declared contract error. A procedure that is expensive or abusable
   (uploads, mail, heavy queries) puts a stricter `rateLimitMiddleware` first. Register it in `app/orpc/router.ts`
   ([architecture.md](./backend/architecture.md) → Middleware, Auth, Rate limiting).
8. **Status codes**: a new error code that oRPC doesn't map already gets its HTTP status in `ERROR_STATUS_MAP`
   (`app/orpc/errors.ts`). `NOT_FOUND`, `CONFLICT`, `UNAUTHORIZED` and `FORBIDDEN` need nothing.
9. **Environment variables**: a new one goes in `app/env.server.ts`, `.env.example`, the `app` service in
   `compose.prod.yaml`, `.env.production.example` and the settings registry in `deploy/deploy.sh`. A required one the
   script can't generate (a domain, an API key, an external URL) gets a kind that asks for it
   ([deployment.md](./deployment.md) → Adding a Variable).

## Check

10. **Logging**: log through `createLogger`, never `console`. Log errors as `log.error({ err }, …)`, which also reports
    them to the error viewer, and wrap slow work that isn't timed automatically in `span(...)`
    ([logging.md](./backend/logging.md)).
11. **Test**: add an `integration.test.ts` if the behavior is consequential: a success case and the failures that
    matter ([architecture.md](./backend/architecture.md) → Testing). Run `pnpm lint` and `pnpm typecheck`, and the
    test itself if the database is running.
12. **Use it**: a page reads the procedure in its `loader` through `createServerClient(request)` or calls it from the
    browser through `orpc` in `app/orpc/client.ts`. Build that side with [frontend-flow.md](./frontend-flow.md).
