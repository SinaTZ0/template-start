# Backend Flow

Start here for any API work. Follow the steps in order for every new feature, skipping the ones it doesn't need. Each
step links to the doc that holds its rules. Read that doc when you reach the step.

| Doc                                                  | Covers                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [backend/architecture.md](./backend/architecture.md) | Structure, layers, contracts, validation, errors, middleware, auth, database, naming |
| [backend/logging.md](./backend/logging.md)           | Writing logs, error reporting (error viewer), request timing, slow-request reports   |
| [backend/media.md](./backend/media.md)               | Image uploads, processing, storage and rendering                                     |
| [backend/jobs.md](./backend/jobs.md)                 | Background jobs: work after a request, retries, schedules                            |
| [deployment.md](./deployment.md)                     | Production stack, deploying, migrations in production, health check, backups         |
| [deploy-tool.md](./deploy-tool.md)                   | The manual of `deploy/deploy.sh`: menu, `.env` check, deploy steps, database browser |

The `note` feature (`src/orpc/note/`) is the worked example. Copy its shape.

## Define

1. **Contract**: write `contract.ts` with the input/output schemas and every error the procedure can throw: the common
   errors, those of the middleware it uses (`authErrors`, `roleErrors`) and its own, each with `errorDataSchema` as its
   data. Register it in the root `src/orpc/contract.ts` ([architecture.md](./backend/architecture.md) → Contract first,
   Errors are uniform and safe).
2. **Validation**: write the domain schemas in `validation.ts`. They check meaning (trimming, normalization, allowed
   values), not structure, which the contract already checks. Their messages reach the user as field errors, so each
   check gets a message function, `{ error: () => m.<feature>_error_<what>() }`, with the key in every locale file
   ([i18n.md](./frontend/i18n.md) → Messages from the API). Free-text fields use `persianText()` ([architecture.md](./backend/architecture.md) → Validation
   happens twice, Free text is normalized).

## Implement

3. **Database**: if the feature stores data, add its tables to `src/db/schema.ts`, record the change with
   `pnpm db:generate --name <what-changed>`, apply it with `pnpm db:migrate`, and commit the migration with the code
   ([architecture.md](./backend/architecture.md) → Database).
4. **Seed**: if a new server needs content to start with (categories, sample rows), write `src/db/seed-<part>.ts`
   with a `db:seed:<part>` script. It must skip what is already loaded. To run on the server it also needs its file
   in the Dockerfile's esbuild line, its part in the deploy tool and its path in `deploy/steps/needs-step.txt`
   (`src/db/seed-notes.ts` is the example; [deployment.md](./deployment.md) → First Deploy, Seed). Later changes to
   its data reach the server through a deploy step.
5. **Repository**: write `repository.ts`, with one focused read or write per function. Queries for a user's records
   filter by the owner ([architecture.md](./backend/architecture.md) → Auth).
6. **Service**: write the rules and orchestration in `service.ts`. It receives `db` and its inputs through one object
   parameter, parses with `validation.ts`, and returns explicit outcomes instead of throwing. `issuesToErrorData`
   (`src/lib/schema-issues.ts`) turns a failed parse into field messages ([architecture.md](./backend/architecture.md)
   → Services return outcomes, Explicit dependencies). Image uploads follow [media.md](./backend/media.md). Work
   that is slow, should be retried or runs on a schedule (mail, calls to other services, clean-ups) is a job the
   service queues in its transaction, declared in the feature's `jobs.server.ts` ([jobs.md](./backend/jobs.md)).
7. **Mapper**: add `mapper.ts` only if the stored and public shapes differ.
8. **Procedure**: in `procedure.ts`, start from `base.<feature>.<procedure>` (`implementer.server.ts`), attach the
   middleware it needs (`requireUserMiddleware` or `requireRoleMiddleware`, then `provideDbMiddleware`), call the
   service, and map each failure outcome to a declared contract error. A procedure that is expensive or abusable
   (uploads, mail, heavy queries) puts a stricter `rateLimitMiddleware` first. Register it in `src/orpc/router.ts`
   ([architecture.md](./backend/architecture.md) → Middleware, Auth, Rate limiting).
9. **Status codes**: a new error code that oRPC doesn't map already gets its HTTP status in `ERROR_STATUS_MAP`
   (`src/orpc/errors.ts`). `NOT_FOUND`, `CONFLICT`, `UNAUTHORIZED` and `FORBIDDEN` need nothing.
10. **Environment variables**: a new one goes in `src/env.server.ts`, `.env.example`, the `app` service in
    `compose.prod.yaml`, `.env.production.example` and the deploy tool's settings registry
    (`tools/deploy/internal/settings/settings.go`). A required one the tool can't generate (a domain, an API key, an
    external URL) gets a kind that asks for it
    ([deployment.md](./deployment.md) → Adding a Variable).

## Check

11. **Logging**: log through `createLogger`, never `console`. Log errors as `log.error({ err }, …)`, which also reports
    them to the error viewer, and wrap slow work that isn't timed automatically in `span(...)`
    ([logging.md](./backend/logging.md)).
12. **Test**: add an `integration.test.ts` if the behavior is consequential: a success case and the failures that
    matter ([architecture.md](./backend/architecture.md) → Testing). Run `pnpm lint` and `pnpm typecheck`, and the
    test itself if the database is running.
13. **Use it**: a page reads the procedure through `orpc.<feature>.<procedure>.queryOptions()` (`src/orpc/client.ts`)
    in its `loader` and component, and mutations invalidate the queries they change. The client calls procedures
    in-process during SSR and over `/rpc` in the browser. Build that side with [frontend-flow.md](./frontend-flow.md)
    and [data-loading.md](./frontend/data-loading.md).
