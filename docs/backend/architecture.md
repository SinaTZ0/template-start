# Backend Architecture (oRPC)

The backend is a contract-first oRPC API organized by feature. Each feature owns everything needed to understand and
change it, each layer has one job, and dependencies only point inward toward persistence.

These are the rules. The steps for adding a feature are in [backend-flow.md](../backend-flow.md).

## Structure

```text
app/orpc/
  contract.ts               # composes feature contracts into the API contract
  router.ts                 # composes feature procedures into the API router
  implementer.server.ts     # implements the contract, declares base context, applies global middleware
  handler.server.ts         # HTTP adapter: RPC handler, plugins, status codes, allowed methods
  client.ts                 # typed browser client and TanStack Query utils, built from the contract only
  server-client.server.ts   # in-process client for loaders and actions, created per request
  errors.ts                 # shared error data shape, common errors, error-code → HTTP status map
  middleware/
    <name>/
      <name>.middleware.ts  # one reusable concern: a guard, a dependency, or error translation
      <name>.errors.ts      # the errors it can throw (browser-safe)
  <feature>/
    contract.ts             # required
    procedure.ts            # required
    service.ts              # required
    repository.ts           # only if the feature persists data
    validation.ts           # domain validation and normalization schemas
    mapper.ts               # only if stored and public shapes differ
    model.ts                # internal (non-public) data shapes
    constants.ts            # browser-safe values shared with the UI
    *.server.ts             # feature-private server helpers (processing, cookies, HTTP details)
    integration.test.ts     # optional, for consequential behavior
```

Shared infrastructure (database client and schema, storage, crypto, generic helpers) lives outside `app/orpc/`, e.g. in
`app/db/` and `app/lib/`. A single resource route mounts the RPC handler. Keep feature folders flat and add files only
when they earn their place. Promote code out of a feature only when a second consumer needs it.

## Layers

| Layer          | Owns                                                                    | Must not                                                |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| **Contract**   | Public input/output schemas and every error the procedure may return.   | Import server code, touch the database, hold rules.     |
| **Procedure**  | Choosing middleware, calling the service, mapping outcomes to errors.   | Contain business rules or queries.                      |
| **Service**    | Business rules, normalization, orchestration, and side-effect ordering. | Import oRPC, throw API/HTTP errors, know the transport. |
| **Repository** | Focused reads and writes, one operation per function.                   | Make business decisions or know about oRPC/API errors.  |
| **Mapper**     | Converting internal records into stable public DTOs.                    | Perform I/O.                                            |
| **Middleware** | One cross-cutting concern applied to many procedures.                   | Import a feature's contract, service, or repository.    |

```text
route → handler → global middleware → contract validation → procedure (+ feature middleware) → service → repository → db
```

Dependency direction: `procedure → service → repository → infrastructure`. Never import upward.

## Rules

### Contract first

- The contract is the source of truth. The client is typed from the contract, never from the router, so no server code
  reaches the browser bundle.
- Contracts, constants, and `*.errors.ts` files are browser-safe. Anything server-only uses the `.server.ts` suffix.
- Every procedure declares all errors it can throw (common, middleware, and feature errors) in its contract.

### Validation happens twice, for different reasons

- **Contract schemas** check structure: types, required fields, unknown keys (`z.strictObject`), and output shape.
- **Service schemas** (`validation.ts`) check meaning: trimming, normalization, allowed values, domain constraints, and
  transformation into storable values. Do not duplicate these rules in the contract.
- Rules that need I/O (uniqueness, existence, ownership) are checked in the service after parsing.
- Browser form schemas are separate from service schemas, even when they currently match.

### Services return outcomes, procedures throw errors

Expected failures are data, not exceptions. A service returns a discriminated union; the procedure translates each
non-success case into a declared contract error.

```ts
// service.ts
type Result =
  { kind: "success"; id: string } | { kind: "invalid"; fields: Record<string, string> } | { kind: "conflict" };

// procedure.ts
const result = await createThing({ db: context.db, input });
if (result.kind === "invalid") throw errors.INVALID_INPUT({ data: { errors: [], fields: result.fields } });
if (result.kind === "conflict") throw errors.CONFLICT({ data: { errors: [], fields: {} } });
return { id: result.id };
```

- Unexpected failures are thrown and left to propagate.
- Infrastructure failures (e.g. database unavailable) are classified at the boundary where they occur, as typed errors,
  and translated into API errors by the middleware that provides that dependency.
- Constraint violations that represent a product outcome (duplicate, already used) are caught and decided by the
  service.

### Errors are uniform and safe

- All errors share one data shape (general errors plus per-field messages) and one code → HTTP status map.
- A global error middleware normalizes every failure. Server errors (5xx) never expose internal messages; they carry an
  ID that correlates with the full error in the server logs.
- Field messages are user-facing; diagnostics are for developers.
- Schema validation failures do not arrive in the shared shape. oRPC throws `BAD_REQUEST` (cause: `ValidationError`)
  for invalid input and `INTERNAL_SERVER_ERROR` (cause: `ValidationError`) for invalid output. The global error
  middleware converts input failures into the shared shape with per-field messages, and treats output failures as
  server errors whose details never reach the client.
- Failures raised by the handler before the procedure runs (e.g. a request body that cannot be decoded) never reach
  middleware. `handler.server.ts` logs them with an interceptor so they are not lost.
- `*.errors.ts` files are plain error maps (codes, default messages, and Zod data schemas). Do not build them with
  oRPC's `error()` factory: it comes from `@orpc/server` and would pull the server package into the browser bundle.
- A thrown error only counts as a declared error when its `code` matches and its `data` passes the declared schema.
  Anything else reaches the client as an unknown error and loses its types, so always build `data` in the shared shape.
  Prefer the typed `errors.X()` constructors; `new ORPCError(...)` is for code without access to them.

### Middleware

- **Global** middleware (procedure timing, then error normalization and its logging) is applied once in the
  implementer, so it wraps validation too.
  The router is assembled with the undecorated implementer, so global middleware never runs twice.
- **Feature-level** middleware is opt-in per procedure with `.use()`. It provides dependencies (`provideDbMiddleware`)
  or enforces guards (`requireUserMiddleware`, origin checks) and passes results through `context`.
- Each middleware lives in its own folder with its errors, and stays generic: it may depend on the shape of the input
  (e.g. `{ token: string }`), never on a specific feature.
- Middleware used by only one feature may stay inside that feature's `procedure.ts`.

### Explicit dependencies

- Services and repositories receive their dependencies (`db`, storage, clock, request utilities) through a single object
  parameter instead of importing singletons. This keeps them reusable outside oRPC and easy to test.
- The procedure is where context is unpacked and passed down.

### Auth

- Better-Auth (`app/lib/auth.server.ts`) owns sign-up, sign-in and sessions at `/api/auth/*`. The sign-up captcha
  (Altcha) is a `before` hook there; the browser gets its challenge from `captcha.createChallenge`.
- `requireUserMiddleware` puts the signed-in user in `context.user`; `requireRoleMiddleware(...roles)` also checks the
  role. Declare `authErrors` (and `roleErrors`) on their contracts.
- Pages are guarded separately with `requireSession({ roles })` on a layout route (`app/lib/session-guard.server.ts`).
  The UI guard is never the only check.

### Testing

- Test consequential behavior end-to-end through the public handler or a contract-typed client: a representative
  success case and the failures that matter (rejection, idempotency, security, cleanup).
- Shared middleware is covered through feature tests rather than its own suite, unless a behavior cannot be reached that
  way.

### Logging

- Server code logs through a tagged pino child (`createLogger("media")` from `app/lib/logger.server.ts`), never
  `console`. Errors go under the `err` key.
- The global error middleware logs every unexpected failure once, with the `errorId` the client receives. Don't log
  and rethrow the same error in services.
- Wrap slow work that isn't timed automatically in `span(...)` from `app/lib/trace.server.ts`.

How to write logs, what each request's timing line means, and how to read a slow request's timeline:
[logging.md](./logging.md).

## Naming

- Contracts: `<feature>Contract`; procedures: `<action><Thing>Procedure`.
- Services use domain verbs (`submitComplaint`, `uploadImage`); repositories use storage verbs (`insertX`, `findX`).
- Middleware: `<verb><Thing>Middleware`; error collections: `<thing>Errors`; error codes: `UPPER_SNAKE_CASE`.
- Router keys are camelCase feature names; feature folders are kebab-case.
