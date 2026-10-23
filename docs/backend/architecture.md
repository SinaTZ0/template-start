# Backend Architecture (oRPC)

The backend is a contract-first oRPC API organized by feature. Each feature owns everything needed to understand and
change it, each layer has one job, and dependencies only point inward toward persistence.

These are the rules. The steps for adding a feature are in [backend-flow.md](../backend-flow.md).

## Structure

```text
src/orpc/
  contract.ts               # composes feature contracts into the API contract
  router.ts                 # composes feature procedures into the API router
  implementer.server.ts     # `implementer` (assembles the router) and `base` (global middleware, builds procedures)
  handler.server.ts         # HTTP adapter: RPC handler, status map, interceptor for pre-procedure failures
  client.ts                 # isomorphic client (in-process on the server, RPCLink in the browser) and Query utils
  errors.ts                 # shared error data shape, common errors, error-code → HTTP status map
  middleware/
    <name>/
      <name>.middleware.ts  # one reusable concern: a guard, a dependency, or error translation
      <name>.errors.ts      # only if it throws its own errors (browser-safe)
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

Shared infrastructure (database client and schema, storage, crypto, generic helpers) lives outside `src/orpc/`, e.g. in
`src/db/` and `src/lib/`. A single resource route (`src/routes/rpc/`) mounts the RPC handler at `/rpc/*`. Keep feature
folders flat and add files only when they earn their place. Promote code out of a feature only when a second consumer
needs it. A feature may call another feature's service (`note` calls `attachMedia` from `media`), never its procedure.

## Layers

| Layer          | Owns                                                                    | Must not                                                |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| **Contract**   | Public input/output schemas and every error the procedure may return.   | Import server code, touch the database, hold rules.     |
| **Procedure**  | Choosing middleware, calling the service, mapping outcomes to errors.   | Contain business rules or queries.                      |
| **Service**    | Business rules, normalization, orchestration, and side-effect ordering. | Import `@orpc/*`, throw API errors, know the transport. |
| **Repository** | Focused reads and writes, one operation per function.                   | Make business decisions or know about oRPC/API errors.  |
| **Mapper**     | Converting internal records into stable public DTOs.                    | Perform I/O.                                            |
| **Middleware** | One cross-cutting concern applied to many procedures.                   | Import a feature's contract, service, or repository.    |

```text
route → handler → global middleware → contract validation → procedure (+ feature middleware) → service → repository → db
```

Dependency direction: `procedure → service → repository → infrastructure`. Never import upward. Services and mappers may
import their contract's types (`Note`, `Media`), because the contract is the public shape they produce.

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
- A check's message is user-facing, so it is a message function called when the check fails:
  `.min(1, { error: () => m.note_error_title_required() })`. Never a string literal, and never `m.*()` evaluated when
  the module loads, which would freeze one locale for every request ([i18n.md](../frontend/i18n.md)).

#### Free text is normalized

Every free-text field (a title, a body, a display name, a search query) is declared with `persianText()`
(`src/lib/persian-text.ts`) in place of `z.string().trim()`, in its service schema and its form schema. It converts
Arabic yeh and kaf to Persian, Arabic-Indic digits to Persian, removes direction marks, the BOM and tatweel, turns NBSP
into a space, drops stray ZWNJs, applies NFC and trims. Text that looks the same is then stored the same, so searches
and comparisons match what the user sees. The checks chained after it (`.min()`, `.max()`) see the normalized value.

- Never use it on emails, passwords, IDs, tokens, URLs or captcha payloads: those must stay byte-exact.
- A search normalizes its input with `normalizePersianText`, so it matches the stored text.
- The sign-up name goes through Better-Auth, not a service schema; `databaseHooks` in `src/lib/auth.server.ts`
  normalize it on create and update.

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

- All errors share one data shape (general errors plus per-field messages) and one code → HTTP status map: oRPC's
  `COMMON_ERROR_STATUS_MAP` plus `ERROR_STATUS_MAP` in `errors.ts` for this app's own codes (`INVALID_INPUT` → 422).
- A global error middleware normalizes every failure. Server errors (5xx) never expose internal messages; they carry an
  ID that correlates with the full error in the server logs.
- Field messages are user-facing, in the request's locale (`getLocale()`, set per request by `paraglideMiddleware`);
  diagnostics, including contract errors' `message`, are for developers and stay in English.
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

- **Global** middleware (procedure timing, then error normalization and its logging, then the general rate limit) is
  applied once on `base`, so it wraps validation too. Every procedure starts from `base.<feature>.<procedure>`. The router is assembled with the
  undecorated `implementer`, because oRPC v2 doesn't dedupe middleware and would otherwise run it twice.
- **Feature-level** middleware is opt-in per procedure with `.use()`. It provides dependencies (`provideDbMiddleware`)
  or enforces guards (`requireUserMiddleware`, origin checks) and passes results through `context`.
- Each middleware lives in its own folder with its errors, and stays generic: it may depend on the shape of the input
  (e.g. `{ token: string }`), never on a specific feature.
- Middleware used by only one feature may stay inside that feature's `procedure.ts`.

### Explicit dependencies

- Services and repositories receive `db` and the request's facts (the user's ID, the input) through a single object
  parameter, never from `context` or a session lookup. A test can then call them with the real database and made-up
  users, as `note/integration.test.ts` does.
- The procedure is where context is unpacked and passed down. `db` arrives in `context` from `provideDbMiddleware`.
- Stateless infrastructure modules (`storage.server.ts`, the logger, `span`) are imported directly. Pass one in only
  when a test needs to replace it.

### Auth

- Better-Auth (`src/lib/auth.server.ts`) owns sign-up, sign-in and sessions at `/api/auth/*`. The sign-up captcha
  (Altcha) is a `before` hook there; the browser gets its challenge from `captcha.createChallenge`.
- `requireUserMiddleware` puts the signed-in user in `context.user`; `requireRoleMiddleware(...roles)` also checks the
  role. Declare `authErrors` (and `roleErrors`) on their contracts. A procedure with neither is public.
- **Ownership is checked in the data layer.** A user's records are read with the owner in the query
  (`findOwnedNote({ id, ownerId })`), so another user's record looks exactly like a missing one (`NOT_FOUND`), never
  `FORBIDDEN`.
- Pages are guarded separately in a layout's `beforeLoad`, from the viewer query (`src/lib/viewer.ts`,
  [data-loading.md](../frontend/data-loading.md) → Guards). The UI guard is never the only check.

### Rate limiting

- One limiter (`src/lib/rate-limit.server.ts`) covers both the API and `/api/auth/*`, keyed by the client address
  that Caddy sends in `X-Real-IP`. Better-Auth's own limiter is off.
- Every procedure gets the general policy from `base` (300 a minute). A procedure that is expensive or abusable adds a
  stricter one as its first middleware: `.use(rateLimitMiddleware(UPLOAD_RATE_LIMIT))`, with the policy defined next to
  the procedure. Policy names must be unique, since they keep the counters apart.
- `TOO_MANY_REQUESTS` is a common error, so contracts already declare it. Its data adds `retryAfterSeconds`, and its
  message (`rateLimitedMessage()`) reaches the form through `describeApiFailure`.
- Auth limits are set by path in `src/routes/api_auth/`: endpoints that check a password or send mail get the strict
  policy. Add new Better-Auth endpoints of that kind to `CREDENTIAL_PATHS`.
- Procedure calls a loader makes during SSR run in-process, with the page request's headers, so they count against
  the same address as the page request.
- Limits are per address, and many Iranian mobile users share one (CGNAT). Keep them high enough for that, and prefer
  a per-procedure policy over lowering the general one.
- Counters are in memory, which fits the single app process production runs. Running several instances needs a shared
  store behind `RateLimitStore`.
- A production request without an address isn't limited, and the limiter logs it ([deployment.md](../deployment.md) →
  Rate Limiting).

### Database

- Drizzle tables live in `src/db/schema.ts`, Better-Auth's tables included. A change to Better-Auth's user fields
  (`additionalFields` in `auth.server.ts`) needs the matching column there.
- While building, sync the local database with `pnpm db:push`. Before committing, run
  `pnpm db:generate --name <what-changed>`, review the SQL in `drizzle/`, and commit it with the schema change.
  Production only runs those files. The details, including renames and changes that span two deploys, are in
  [deployment.md](../deployment.md) → Database Changes.
- Back what a query filters and sorts by with an index (`note_owner_id_created_at_idx`).

### Testing

- Test consequential behavior against the real database (`DATABASE_URL`): a representative success case and the
  failures that matter (rejection, ownership, idempotency, cleanup). Call the service directly; it takes `db` as a
  parameter, so no HTTP or session is needed.
- Test through `createRouterClient(router, { context: { headers } })` or the RPC handler only when the behavior lives above the service: auth middleware,
  the error shape, status codes.
- Each test creates its own rows with a per-run ID and deletes them afterwards, so it can run against a development
  database.

### Logging

Log through `createLogger`, never `console`, and wrap slow work in `span(...)`. The rules, the timing line and how to
read a slow request are in [logging.md](./logging.md).

## Naming

- Contracts: `<feature>Contract`; procedures: `<action><Thing>Procedure`.
- Services use domain verbs (`submitComplaint`, `uploadImage`); repositories use storage verbs (`insertX`, `findX`).
- Middleware: `<verb><Thing>Middleware`; error collections: `<thing>Errors`; error codes: `UPPER_SNAKE_CASE`.
- Router keys are camelCase feature names; feature folders are kebab-case.
