# Backend Flow

Start here for any API work. Follow the steps in order for every new feature, skipping the ones it doesn't need. Each
step links to the doc that holds its rules. Read that doc when you reach the step.

| Doc                                                  | Covers                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| [backend/architecture.md](./backend/architecture.md) | Structure, layers, Effect boundary, errors, auth, database |
| [backend/logging.md](./backend/logging.md)           | Logs, error viewer, request timing, OpenTelemetry export   |
| [backend/media.md](./backend/media.md)               | Image uploads, processing, storage and rendering           |
| [backend/jobs.md](./backend/jobs.md)                 | Background jobs: work after a request, retries, schedules  |
| [backend/mail.md](./backend/mail.md)                 | Email through the app's mailbox, templates, `mail.send`    |
| [deployment.md](./deployment.md)                     | Production stack, deploying, migrations, health, backups   |
| [deploy-tool.md](./deploy-tool.md)                   | `deploy/deploy.sh`: menu, `.env` check, steps, database    |

The server code is Effect v4: read the `effect` skill (`.agents/skills/effect/SKILL.md`) before writing any. The `note`
feature (`src/orpc/note/`) is the worked example, and `media` (`src/orpc/media/`) the one with jobs. Copy their shape.

## Define

1. **Contract**: write `contract.ts` with the input/output schemas (Effect Schema, wrapped in `standardSchema` from
   `src/lib/schema.ts`) and every error the procedure can return: `commonErrors`, `authErrors` when it sets `access`,
   `roleErrors` when that is a list of roles, `captchaErrors` when it sets `captcha`, and its own, each with
   `errorDataSchema` as its data. Contract schemas check structure only and never transform; optional input fields are
   `Schema.optional`. Register it in the root `src/orpc/contract.ts` ([architecture.md](./backend/architecture.md) →
   Contract first, Validation happens twice, Errors are uniform and safe).
2. **Validation**: write the domain schemas in `validation.ts`. They check meaning (trimming, normalization, allowed
   values, limits), not structure, which the contract already checks. Their messages reach the user as field errors,
   so each check gets a message function as its `text`, `{ text: () => m.<feature>_error_<what>() }`, with the key in
   every locale file ([i18n.md](./frontend/i18n.md) → Messages from the API). Free-text fields use `PersianText`
   ([architecture.md](./backend/architecture.md) → Validation happens twice, Free text is normalized).
3. **Errors**: declare each expected failure in `errors.ts` as a `Schema.TaggedError`, named for the fact
   (`NoteNotFound`) and carrying facts, never text ([architecture.md](./backend/architecture.md) → Services fail with
   tagged errors, procedures map them).

## Implement

4. **Database**: if the feature stores data, add its tables to `src/db/schema.ts`, record the change with
   `pnpm db:generate --name <what-changed>`, apply it with `pnpm db:migrate`, and commit the migration with the code
   ([architecture.md](./backend/architecture.md) → Database).
5. **Seed**: if a new server needs content to start with (categories, sample rows), write `src/db/seed-<part>.ts`
   with a `db:seed:<part>` script. It must skip what is already loaded. To run on the server it also needs its file
   in the Dockerfile's esbuild line, its part in the deploy tool and its path in `deploy/steps/needs-step.txt`
   (`src/db/seed-notes.ts` is the example; [deployment.md](./deployment.md) → First Deploy, Seed). Later changes to
   its data reach the server through a deploy step.
6. **Repository**: write `repository.ts`, a `Context.Service` class (`NoteRepo`) whose layer takes `Db`. One focused
   read or write per method, each an `Effect.fn("<Feature>Repo.<method>")` that ends in `Effect.orDie`. Queries for a
   user's records filter by the owner ([architecture.md](./backend/architecture.md) → Services and layers, Auth,
   Database).
7. **Service**: write the rules and orchestration in `service.ts`, a `Context.Service` class (`NoteService`) whose
   methods are `Effect.fn("<Feature>Service.<method>")` and take the request's facts (`ownerId`, the input) as
   arguments. It decodes the input with `decodeInput(<schema>)` (`src/server/errors.ts`), fails with the tagged errors
   of step 3, and runs writes that must land together in `db.transaction(…)`. Image uploads follow
   [media.md](./backend/media.md). Work that is slow, should be retried or runs on a schedule (mail, calls to other
   services, clean-ups) is a job the service queues in its transaction, declared in the feature's `jobs.server.ts`
   ([jobs.md](./backend/jobs.md)). An email is a template and a `SendMail.enqueue` ([mail.md](./backend/mail.md) →
   Adding an Email). Add the repository's and the service's layers to `FeaturesLive` in
   `src/server/runtime.server.ts`.
8. **Mapper**: add `mapper.ts` only if the stored and public shapes differ.
9. **Procedure**: in `procedure.ts`, implement `base.<feature>.<procedure>` (`implementer.server.ts`) with
   `effectProcedure` (`src/orpc/effect.server.ts`): `access` for who may call it, `rateLimit` for a procedure that is
   expensive or abusable (uploads, mail, heavy queries), `captcha` for a public one that writes, `run` calling the
   service, and `errors` with a case for each of the service's tagged errors, where the message a person reads is
   written. Register it in `src/orpc/router.ts` ([architecture.md](./backend/architecture.md) → The boundary, Auth,
   Rate limiting).
10. **Status codes**: a new error code that oRPC doesn't map already gets its HTTP status in `ERROR_STATUS_MAP`
    (`src/orpc/errors.ts`). `NOT_FOUND`, `CONFLICT`, `UNAUTHORIZED` and `FORBIDDEN` need nothing.
11. **Environment variables**: a new one goes in `AppConfig` (`src/server/config.server.ts`, a secret as
    `Config.Redacted`), `.env.example`, the `app` service in `compose.prod.yaml`, `.env.production.example` and the
    deploy tool's settings registry (`tools/deploy/internal/settings/settings.go`). A required one the tool can't
    generate (a domain, an API key, an external URL) gets a kind that asks for it
    ([deployment.md](./deployment.md) → Adding a Variable).

## Check

12. **Logging**: log with `Effect.logInfo` / `Effect.logWarning` / `Effect.logError`, annotated with
    `Effect.annotateLogs`, and log an error as a cause (`Effect.logError("…", cause)`), which also reports it to the
    error viewer. Outside Effect, use `createLogger`, never `console`. `Effect.fn` names are the spans; wrap other slow
    work in `Effect.withSpan` ([logging.md](./backend/logging.md)).
13. **Test**: add an `integration.test.ts` if the behavior is consequential: a success case and the failures that
    matter, run on a runtime built from `AppLayer` ([architecture.md](./backend/architecture.md) → Testing). Run
    `pnpm lint` and `pnpm typecheck`, and the test itself if the database is running.
14. **Use it**: a page reads the procedure through `orpc.<feature>.<procedure>.queryOptions()` (`src/orpc/client.ts`)
    in its `loader` and component, and mutations invalidate the queries they change. The client calls procedures
    in-process during SSR and over `/rpc` in the browser. Build that side with [frontend-flow.md](./frontend-flow.md)
    and [data-loading.md](./frontend/data-loading.md).
