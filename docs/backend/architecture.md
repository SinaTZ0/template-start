# Backend Architecture (Effect behind oRPC)

The backend is a contract-first oRPC API organized by feature, with the server code written in Effect v4. oRPC owns the
transport: contracts, the HTTP handler, the typed client. Effect owns everything behind it: services, typed failures,
the database, jobs, logs and spans. One function, `effectProcedure`, joins the two. Each feature owns everything needed
to understand and change it, each layer has one job, and dependencies only point inward toward persistence.

These are the rules. The steps for adding a feature are in [backend-flow.md](../backend-flow.md). How to write Effect
code in this project (v4 names, services, `Effect.fn`, common mistakes) is the `effect` skill
(`.agents/skills/effect/SKILL.md`); read it before writing any.

## Structure

```text
src/server/                   # the platform: each piece of infrastructure as an Effect service
  config.server.ts            # `AppConfig`: every setting, read from the process's environment (`serverEnv`)
  load-env.server.ts          # loads `.env` in development (`process.loadEnvFile`); a variable already set wins
  db.server.ts                # `PgLive` (the Postgres pool) and `Db` (Drizzle's Effect client, ambient transactions)
  jobs.server.ts              # `defineJob`, `Jobs` (Effect's persisted queue in Postgres), `runJobWorkers`
  storage.server.ts           # `Storage`: the S3-compatible bucket
  mailer.server.ts            # `Mailer`: the SMTP mailbox, and `MailDeliveryError`
  captcha.server.ts           # `Captcha`: Altcha challenges and their verification
  auth.server.ts              # `Auth`: Better-Auth, built in the layer, and the session reads
  better-auth.server.ts       # the Better-Auth configuration `Auth` builds
  request-context.server.ts   # `RequestContext`, `CurrentUser`, `requireUser`, `requireRole`
  rate-limit.server.ts        # `checkRateLimit`: the limiter (`src/lib/rate-limit.server.ts`) as an Effect
  errors.ts                   # the shared tagged errors and `decodeInput`
  runtime.server.ts           # `AppLayer`, `AppServices`, and `appRuntime`, the server's one `ManagedRuntime`
  observability/              # log lines, spans, error reports and export (logging.md)
src/orpc/
  contract.ts                 # composes feature contracts into the API contract
  router.ts                   # composes feature procedures into the API router
  implementer.server.ts       # `implementer` (assembles the router) and `base` (builds procedures)
  effect.server.ts            # `effectProcedure`: the boundary between oRPC and Effect
  handle-errors.server.ts     # normalizes the errors oRPC raises itself (contract validation)
  handler.server.ts           # HTTP adapter: RPC handler, status map, checks before the body is read
  client.ts                   # isomorphic client (in-process on the server, RPCLink in the browser) and Query utils
  errors.ts                   # shared error data shape, common errors, error-code → HTTP status map
  <feature>/
    contract.ts               # required
    procedure.ts              # required
    service.ts                # the feature's rules (none when it only hands out a value: `captcha`, `site`)
    errors.ts                 # its expected failures, as tagged errors
    repository.ts             # only if the feature persists data
    validation.ts             # domain validation and normalization schemas
    mapper.ts                 # only if stored and public shapes differ
    constants.ts              # browser-safe values shared with the UI
    jobs.server.ts            # only if it has background jobs (jobs.md); each is listed in src/jobs.server.ts
    *.server.ts               # feature-private server helpers (`media/processing.server.ts`)
    integration.test.ts       # optional, for consequential behavior
```

Other shared code (the database schema, seeds, generic helpers) lives in `src/db/` and `src/lib/`. A single resource
route (`src/routes/rpc/`) mounts the RPC handler at `/rpc/*`. Keep feature folders flat and add files only when they
earn their place. Promote code out of a feature only when a second consumer needs it. A feature may use another
feature's service (`NoteService` uses `MediaService`), never its procedure. `note` and `media` are the worked examples.

## Layers

| Layer          | Owns                                                       | Must not                            |
| -------------- | ---------------------------------------------------------- | ----------------------------------- |
| **Contract**   | Input/output schemas and every error it may return.        | Import server code, hold rules.     |
| **Procedure**  | Access options, calling the service, mapping its errors.   | Hold business rules or queries.     |
| **Service**    | Business rules, normalization, transactions, side effects. | Import `@orpc/*` or messages.       |
| **Repository** | Focused reads and writes, one operation per method.        | Make business decisions.            |
| **Mapper**     | Turning internal records into stable public DTOs.          | Perform I/O.                        |
| **Platform**   | One piece of infrastructure as a service (`src/server/`).  | Hold a feature's rules or its text. |

```text
route → handler → handleErrorsMiddleware → contract validation → effectProcedure → service → repository → Db
```

Dependency direction: `procedure → service → repository → platform`. Never import upward. Services and mappers may
import their contract's types (`Note`, `Media`), because the contract is the public shape they produce.

## Rules

### Contract first

- The contract is the source of truth. The client is typed from the contract, never from the router, so no server code
  reaches the browser bundle.
- Contracts, constants, `errors.ts` and `validation.ts` are browser-safe. Anything server-only uses the `.server.ts`
  suffix.
- Schemas are Effect Schema, turned into the Standard Schema oRPC reads by `standardSchema` (`src/lib/schema.ts`). It
  reports every issue and rejects keys the schema doesn't name.
- Every procedure declares all errors it can return (common, access, captcha, and its own) in its contract.

### Validation happens twice, for different reasons

- **Contract schemas** check structure: types, required fields, unknown keys, and output shape. They never transform:
  oRPC also runs a procedure's output through its schema, so a transforming one would change what the client receives.
- An optional input field is `Schema.optional`, not `Schema.optionalKey`. A loader passes `{ cursor: undefined }`,
  which `optionalKey` rejects (`src/orpc/access.test.ts` checks it).
- **Service schemas** (`validation.ts`) check meaning: trimming, normalization, allowed values, limits, and
  transformation into storable values. Do not duplicate these rules in the contract. The service decodes with
  `decodeInput(schema)` (`src/server/errors.ts`), which fails with `InvalidInput` holding every issue.
- Rules that need I/O (uniqueness, existence, ownership) are checked in the service after decoding.
- Browser form schemas are separate from service schemas, even when they currently match
  (`src/components/shared/note-form/note-form.schema.ts`).
- A check's message is user-facing, so it is a `text` annotation holding a message function, called when the issue is
  formatted: `Schema.isMinLength(1, { text: () => m.note_error_title_required() })`. Never a string literal, and never
  `m.*()` evaluated when the module loads, which would freeze one locale for every request
  ([i18n.md](../frontend/i18n.md)). The service never sees the words: the boundary formats `InvalidInput`'s issue with
  `issueToErrorData` (`src/lib/schema.ts`) after the Effect has run, in the request's locale.

#### Free text is normalized

Every free-text field (a title, a body, a display name, a search query) is declared with `PersianText`
(`src/lib/schema.ts`) in place of `Schema.String`, in its service schema and its form schema. It decodes through
`normalizePersianText` (`src/lib/persian-text.ts`): it converts Arabic yeh and kaf to Persian, Arabic-Indic digits to
Persian, removes direction marks, the BOM and tatweel, turns NBSP into a space, drops stray ZWNJs, applies NFC and
trims. Text that looks the same is then stored the same, so searches and comparisons match what the user sees. The
checks chained after it (`PersianText.check(Schema.isMaxLength(…))`) see the normalized value.

- Never use it on emails, passwords, IDs, tokens, URLs or captcha payloads: those must stay byte-exact.
- A search normalizes its input with `normalizePersianText`, so it matches the stored text.
- The sign-up name goes through Better-Auth, not a service schema; `databaseHooks` in `src/server/better-auth.server.ts`
  normalize it on create and update, and a `before` hook checks its length as stored.

### Services fail with tagged errors, procedures map them

Expected failures are typed. A feature's `errors.ts` declares each as a `Schema.TaggedError`, named for the fact and
carrying facts, never text. The service fails with it, and its type lists every way it can fail
(`Effect.Effect<Note, NoteNotFound | InvalidInput | MediaUnusable>`). The procedure maps each one to a declared
contract error:

```ts
// errors.ts
export class NoteNotFound extends Schema.TaggedError<NoteNotFound>()("NoteNotFound", { id: Schema.String }) {}

// service.ts
const owned = yield* notes.lockOwned({ id, ownerId });
if (Option.isNone(owned)) return yield* new NoteNotFound({ id });

// procedure.ts
errors: {
  NoteNotFound: ({ errors }) => errors.NOT_FOUND({ data: noErrorData }),
},
```

- The `errors` map needs a case for every tagged error the Effect can fail with, the shared ones in
  `src/server/errors.ts` aside. A service that starts failing in a new way doesn't compile until each procedure that
  calls it says what the client sees. The message is written in the case, in the request's locale (`imageUnusable` in
  `src/orpc/note/procedure.ts`).
- Everything else is a defect: a failed query, a bucket that refuses, a bug. Repositories end every method in
  `Effect.orDie`, and `Storage` dies when the bucket fails. The boundary logs a defect once and answers
  `INTERNAL_SERVER_ERROR` with an `errorId`.
- A promise API whose failure is an expected outcome is wrapped with `Effect.tryPromise` and a `catch` that builds a
  tagged error (`Mailer.send` and `MailDeliveryError`). `Effect.promise` turns a rejection into a defect.
- A race that is a product outcome (two saves claiming one upload) is decided by the service from what the repository
  returns (`MediaRepo.claim` answers whether it won), never by catching a failed query.

### Errors are uniform and safe

- All errors share one data shape, `ErrorData` (general errors plus per-field messages), and one code → HTTP status
  map: oRPC's `COMMON_ERROR_STATUS_MAP` plus `ERROR_STATUS_MAP` in `src/orpc/errors.ts` for this app's own codes
  (`INVALID_INPUT` → 422, `CAPTCHA_FAILED` → 400).
- The boundary maps the shared tagged errors once (`commonError` in `src/orpc/effect.server.ts`): `Unauthorized` →
  `UNAUTHORIZED`, `Forbidden` → `FORBIDDEN`, `InvalidInput` → `INVALID_INPUT` with per-field messages, `RateLimited` →
  `TOO_MANY_REQUESTS`, `CaptchaFailed` → `CAPTCHA_FAILED`.
- Server errors (5xx) never expose internal messages; they carry an `errorId` that finds the full error in the logs
  and the error viewer.
- Field messages are user-facing, in the request's locale (`getLocale()`, set per request by `paraglideMiddleware`);
  diagnostics, including contract errors' `message`, are for developers and stay in English.
- Contract validation failures don't arrive in the shared shape. oRPC throws `BAD_REQUEST` (cause: `ValidationError`)
  for invalid input and `INTERNAL_SERVER_ERROR` (cause: `ValidationError`) for invalid output. `handleErrorsMiddleware`
  (`src/orpc/handle-errors.server.ts`), the one middleware on `base`, converts input failures into `INVALID_INPUT` with
  per-field messages, and logs output failures as server errors whose details never reach the client.
- A client that disconnects interrupts the Effect, which rolls back its open transaction; the call ends as
  `CLIENT_CLOSED_REQUEST`.
- Failures raised by the handler before the procedure runs (e.g. a request body that cannot be decoded) never reach a
  procedure. `handler.server.ts` logs them with an interceptor so they are not lost.
- Contract error maps (`commonErrors`, `authErrors`, `roleErrors`, `captchaErrors`) are plain objects of codes, default
  messages and data schemas. Do not build them with oRPC's `error()` factory: it comes from `@orpc/server` and would
  pull the server package into the browser bundle.
- A thrown error only counts as a declared error when its `code` matches and its `data` passes the declared schema.
  Anything else reaches the client as an unknown error and loses its types, so build errors with the typed
  constructors the `errors` cases receive (`errors.NOT_FOUND({ data: noErrorData })`).

### The boundary: `effectProcedure`

Every procedure is a contract procedure from `base`, implemented with `effectProcedure` (`src/orpc/effect.server.ts`):

```ts
export const deleteNoteProcedure = effectProcedure(base.note.delete, {
  access: "user",
  run: ({ input }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      yield* (yield* NoteService).remove({ ownerId: user.id, id: input.id });
    }),
  errors: {
    NoteNotFound: ({ errors }) => errors.NOT_FOUND({ data: noErrorData }),
  },
});
```

| Option      | What it does                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `access`    | `"user"` for any signed-in user, or a list of roles (`["admin"]`). Left out: a public procedure. |
| `rateLimit` | A stricter policy than the API's, for an expensive procedure (Rate limiting below).              |
| `captcha`   | `true` for a public procedure that writes: `input.captcha` must be a solved challenge.           |
| `run`       | The Effect, given the decoded input. It may require `AppServices` and `RequestContext`.          |
| `errors`    | One case per feature error the Effect can fail with (above); `{}` when it has none.              |

Before `run`, in this order: the API's rate limit, the procedure's own, the captcha, then the session. A flood is
turned away before any verification or session work. Then:

- **Access.** With `access`, the signed-in user is provided as `CurrentUser`. Without it, code that requires
  `CurrentUser` doesn't compile, so a public procedure can't call a service that needs a user.
- **The request.** `RequestContext` holds the request's headers (`session.viewer` reads them). Effect code learns about
  the request only through it: it never calls Start's `getRequest*` helpers or reads `AsyncLocalStorage`.
- **Tracing.** The call is an `rpc.<path>` span (`rpc.note.list`) whose parent is the request's root span, read from
  the request scope before the fiber starts. A loader's in-process call and a browser's call over `/rpc` are traced
  alike. Its log lines carry `module: "orpc"`, the browser's `clientId` and, after access, the user's `userId`.
- **The runtime.** Effects run on `appRuntime`, unless the oRPC context carries a `runtime` (tests only).

`base` (`src/orpc/implementer.server.ts`) has only `handleErrorsMiddleware`. The router is assembled with the
undecorated `implementer`, because oRPC v2 doesn't dedupe middleware and would otherwise run it twice. There are no
other oRPC middlewares: a cross-cutting concern is an option of `effectProcedure` or a service.

### Services and layers

- Each repository and service is a `Context.Service` class with a `static readonly layer`, built with `Layer.effect`
  from its dependencies, which it yields once (`const { q } = yield* Db`). Its methods are
  `Effect.fn("Owner.method")`: the name is the span, and its shape (`NoteService.list`, `NoteRepo.findOwned`) sorts it
  into a kind in the request timeline ([logging.md](./logging.md)).
- Request facts (the user's ID, the input) are method arguments. The procedure reads `CurrentUser` and passes
  `ownerId`; a service never asks for the session. A test can then call it with made-up users, as
  `note/integration.test.ts` does.
- Every layer is part of `AppLayer` (`src/server/runtime.server.ts`): a feature's repository and service go into
  `FeaturesLive`. A procedure whose Effect requires a service missing from `AppServices` doesn't compile.
- Settings come from `AppConfig`, never `process.env`. Secrets are `Redacted`: logged or serialized, they print
  `<redacted>`. Effect's default config provider also reads `import.meta.env`, which Vite freezes at build time, so
  everything reads through `serverEnv`.
- **Transactions are ambient.** `db.transaction(effect)` runs `effect` in one transaction, and every query and job
  enqueue inside it, in any repository, joins it: nothing passes a `tx` down. A failure or defect rolls it back; a
  typed failure keeps its type. `NoteService.edit` locks the note, attaches the new image and releases the old one
  (which queues the deletion of its files) in one transaction. Work outside the database, such as deleting files from
  the bucket, is a job queued in the transaction, so it happens only if the transaction commits.
- **Only boundaries run Effects**: `effectProcedure`, the server entry (`observeRequest`, the job workers), the
  server routes outside oRPC (`/api/auth/*`, `/healthz`, `/robots.txt`, `/sitemap.xml`), Better-Auth's callbacks
  (`src/server/auth.server.ts`), seeds and tests. Everywhere else, compose with `yield*`.
- A promise API is wrapped once, in its platform service (`Storage`, `Mailer`, `Auth`), and used as Effects from
  there. Effect's `@stability unstable` modules (`effect/sql`, `effect/persistence`, `effect/observability`) are used
  only inside `src/server/`.

### Auth

- Better-Auth owns sign-up, sign-in and sessions at `/api/auth/*` (`src/routes/api_auth/`). The `Auth` layer builds it
  (`createBetterAuth` in `src/server/better-auth.server.ts`) from `AppConfig`, with its own small `pg` pool named
  `auth`, since its adapter speaks promises. Server code reads sessions through `Auth.session(headers)`.
- The sign-up captcha (Altcha) is a `before` hook there, checked with `Captcha.verify`; the browser gets its challenge
  from `captcha.createChallenge`.
- An account is used once its address is confirmed: sign-up sends a link instead of signing in, and a sign-in before
  confirming sends a fresh one. Sign-up answers an address that already has an account like a new one (the owner gets
  an email instead), and a reset request answers the same for every address, so neither tells who has an account. A
  password reset signs the account out everywhere. The emails are queued as `mail.send` jobs ([mail.md](./mail.md));
  the pages their links land on are `/verify-email` and `/reset-password`, and `/forgot-password` asks for a reset.
- A public procedure that writes (a contact form, a comment, a signup for news) takes a solved challenge too, so
  scripts can't fill its tables. Its input has `captcha: Schema.String`, its contract declares `captchaErrors`, and the
  procedure sets `captcha: true`. `effectProcedure` verifies it after the rate limits, so a flood is turned away before
  any verification work:

  ```ts
  export const submitContactProcedure = effectProcedure(base.contact.submit, {
    rateLimit: SUBMIT_RATE_LIMIT,
    captcha: true,
    run: ({ input }) => ContactService.use((contact) => contact.submit(input)),
    errors: {},
  });
  ```

  The browser solves it with `useCaptcha` (`src/hooks/use-captcha.ts`), the same hook sign-up uses. For a visible
  «I'm not a robot» check beside the submit button, `useCaptchaCheck` solves in the background from the form's first
  focus, so the answer is usually ready when the visitor sends. A payload works once and expires after 10 minutes, so
  a failed send needs a new solve (`start` again).

  No procedure in the template is public and writes, so none uses it yet; `src/server/captcha.server.test.ts` shows a
  solved, a reused and an unsolved payload.

- `access: "user"` provides the signed-in user as `CurrentUser`; `access: ["admin"]` also checks the role
  (`note.stats` is for admins only). Declare `authErrors` (and `roleErrors`) on their contracts. A procedure without
  `access` is public. The page asks for a role's data only for that role (the notes loader reads `note.stats` for
  admins), since the procedure answers anyone else with `FORBIDDEN`.
- **Ownership is checked in the data layer.** A user's records are read with the owner in the query
  (`NoteRepo.findOwned({ id, ownerId })`), so another user's record looks exactly like a missing one (`NOT_FOUND`),
  never `FORBIDDEN`. An ID from the client is checked to be a UUID before it reaches a query (`isNoteId`,
  `isMediaId`), since a malformed one would make Postgres fail; it reads as not found.
- Pages are guarded separately in a layout's `beforeLoad`, from the public `session.viewer` procedure (the signed-in
  person or `null`; it revokes a blocked account's sessions, [data-loading.md](../frontend/data-loading.md) → Guards).
  The UI guard is never the only check.
- **CSRF.** `/rpc` only accepts POST, and Better-Auth sets its session cookie `SameSite=Lax`, so a request from another
  site arrives without the session. Keep both: don't allow GET on the RPC handler, and don't loosen the cookie's
  `sameSite`. A sibling subdomain counts as the same site and does send the cookie, so the handler also refuses a
  request whose `Origin` names another host (`assertSameOrigin` in `src/orpc/handler.server.ts`). The app has no server
  functions (`createServerFn`), which would be a second way in to protect.
- **Before the body is read.** oRPC decodes a request's body before any procedure runs. The handler therefore checks
  the origin and a rate limit first, and caps the body at 1 MB. A procedure that takes a file is listed in
  `UPLOAD_PATHS` (`src/orpc/handler.server.ts`), which gives it the upload size and a stricter limit.

#### Roles and blocked accounts

A role is a value of `USER_ROLES` and a status a value of `USER_STATUSES` (`src/lib/user-constants.ts`), both stored
as text on `user`, so neither needs a migration. Sign-up can't set them (`input: false` in `better-auth.server.ts`):
everyone starts as an active `user`.

A new role touches:

1. `USER_ROLES`, which is its type.
2. `ROLE_HOME` (`src/lib/viewer.ts`): where the role lands after sign-in. The type makes this one required.
3. The layout guards: add it to the `ROLES` of every layout whose pages it may open (`notes_layout`), or give its
   pages their own layout with their own `ROLES`.
4. The procedures: `access: ["editor", "admin"]` on what the role may call, with `roleErrors` on the contract. A
   procedure with `access: "user"` is open to every role.
5. How an account gets it. Only the server sets a role: the seed (`src/db/seed.ts`) and the deploy tool's Make admin
   set `admin`; any other role needs the project's own admin procedure (`access: ["admin"]`), or an `update` by hand
   until that exists.

Blocking an account is setting `user.status` to `blocked`. Nothing in the template does it yet, so until the project
has an admin screen it is an `update` by hand (the deploy tool's database browser in production). From then on sign-in
refuses the account, `requireUser` fails with `Unauthorized` whatever session it holds, and the next guarded page it
opens deletes its sessions (`session.viewer`). A procedure that blocks someone should call
`Auth.revokeSessions(userId)` itself, so the sessions end at once. Unblocking is setting it back to `active`.

### Rate limiting

- One limiter (`src/lib/rate-limit.server.ts`) covers both the API and `/api/auth/*`, keyed by the client address
  that Caddy sends in `X-Real-IP`. An IPv6 address is counted by its `/64`, the block one subscriber gets
  (`addressKey`). Better-Auth's own limiter is off. Effect code counts through `checkRateLimit`
  (`src/server/rate-limit.server.ts`), which fails with `RateLimited`.
- `effectProcedure` counts every call against the API's policy (300 a minute). A procedure that is expensive or
  abusable adds a stricter one with `rateLimit`, defined next to the procedure (`UPLOAD_RATE_LIMIT` in
  `src/orpc/media/procedure.ts`). Both are counted before the session is read. Policy names must be unique, since they
  keep the counters apart.
- `TOO_MANY_REQUESTS` is a common error, so contracts already declare it. Its data adds `retryAfterSeconds`, and its
  message (`rateLimitedMessage()`) reaches the form through `describeApiFailure`.
- Auth limits are set by path in `src/routes/api_auth/api-auth.ts`: endpoints that check a password or send mail get
  the strict policy. Add new Better-Auth endpoints of that kind to `CREDENTIAL_PATHS`.
- Procedure calls a loader makes during SSR run in-process, with the page request's headers, so they count against
  the same address as the page request.
- Browser calls are also counted once at the handler, before their body is read, with the same numbers on separate
  counters (`RPC_RATE_LIMIT`, `RPC_UPLOAD_RATE_LIMIT`). When a procedure's policy is stricter than the general one and
  its body is large, give its path the same numbers there.
- Limits are per address, and many Iranian mobile users share one (CGNAT). Keep them high enough for that, and prefer
  a per-procedure policy over lowering the general one.
- Counters are in memory, which fits the single app process production runs. Running several instances needs a shared
  store behind `RateLimitStore`. The captcha's record of used solutions (`Captcha`) is in memory for the same reason.
- A production request without an address isn't limited, and the limiter logs it ([deployment.md](../deployment.md) →
  Rate Limiting).

### Database

- Drizzle tables live in `src/db/schema.ts`, Better-Auth's tables included. A change to Better-Auth's user fields
  (`additionalFields` in `better-auth.server.ts`) needs the matching column there.
- Queries go through `Db` (`src/server/db.server.ts`): `q` is Drizzle 1.0's Effect client
  (`drizzle-orm/effect-postgres`) on Effect's Postgres driver (`@effect/sql-pg`), so `yield* q.select().from(note)`
  runs a query. A failed query fails with Drizzle's `EffectDrizzleQueryError`, which repositories turn into a defect
  with `Effect.orDie`.
- Every schema change is a migration, locally too: run `pnpm db:generate --name <what-changed>`, review the SQL in
  `drizzle/`, apply it with `pnpm db:migrate`, and commit it with the schema change. Production only runs those
  files. The details, including renames and changes that span two deploys, are in
  [deployment.md](../deployment.md) → Database Changes.
- To change a migration that isn't committed yet, put `drizzle/` back to the last commit
  (`git restore drizzle && git clean -f drizzle`), generate again and run `pnpm db:reset`.
- Don't use `pnpm db:push` on a database that `db:migrate` manages: it creates the tables without recording a
  migration, and the next `db:migrate` fails on tables that already exist.
- The job queue's tables (`effect_queue`, `effect_queue_migrations`) are created and upgraded by the queue itself when
  the app starts ([jobs.md](./jobs.md)). They are not in `schema.ts` and need no migration.
- The pool (`PgLive`, ten connections) fails a query that waits more than 5 seconds for a connection, and Postgres
  cancels a statement after 30 seconds and ends a transaction left idle for 60. Better-Auth's own pool has the same
  limits and five connections. A job that needs longer (a report, a bulk import) sets its own `statement_timeout`
  inside its transaction (`set local`).
- Back what a query filters and sorts by with an index (`note_owner_id_created_at_idx`), and index a foreign key
  column whose parent rows get deleted (`note_image_media_id_idx`): Postgres doesn't do it for you, and clearing the
  references would scan the table.
- Time columns are `timestamptz(...)` (the helper at the top of `schema.ts`), never a plain `timestamp`: that type
  keeps no zone, so `now()` and psql read and write it in the session's zone.
- A list that can grow returns a page and a cursor, not everything (`NoteService.list`): the query continues after the
  last row's sort values (`NoteRepo.findByOwner`) and reads one row more than a page to know whether another follows.
  A column the cursor compares is stored with the precision a JavaScript `Date` holds (`note.created_at`,
  milliseconds).
- A change that depends on what the row holds now reads it with `for update` in its transaction
  (`NoteRepo.lockOwned`, before an edit swaps the note's image), so two at once can't both act on the old value.
- A column that holds one of a fixed set of values (a status, a kind) is `text`, with the set as a `const` array in
  the feature's `constants.ts`: adding a value then needs no migration. Code narrows what it reads with a guard
  (`isMediaKind`) or `oneOf({ allowed, value, what })` (`src/orpc/allowed-values.ts`), and treats a value outside the
  set as a defect rather than passing on a guess, since only code writes these columns.
- Text editors write in each language (a category's name, a page's title) is a `jsonb` `LocalizedText`
  (`src/lib/localized-text.ts`), read with `localize()` in the request's locale ([frontend/i18n.md](../frontend/i18n.md)
  → Content in Several Languages).

### Testing

- Test consequential behavior against the real database (`DATABASE_URL`, after `pnpm db:migrate`): a representative
  success case and the failures that matter (rejection, ownership, idempotency, cleanup). Build a runtime from the
  app's own layers (`ManagedRuntime.make(AppLayer)`), run the service's Effects on it, and dispose it in `afterAll`.
  An expected failure is read with `Effect.flip` and checked by its class (`NoteNotFound`). `note/integration.test.ts`
  and `media/integration.test.ts` do this.
- Replace a platform service with a test layer when the real one would reach outside: `Mailer.layerMemory` keeps what
  is sent (`src/mail/jobs.server.test.ts`), `Storage.layerMemory` is a bucket in memory, `Auth.layerTest` returns a
  fixed session.
- Test through `createRouterClient(router, { context: { headers, runtime } })` or the RPC handler only when the
  behavior lives at the boundary: access, the error shape, status codes. `src/orpc/access.test.ts` does it for a
  signed-out visitor, a blocked account and the wrong role, with a runtime whose `Auth` is `Auth.layerTest`.
- Each test creates its own rows with a per-run ID and deletes them afterwards, so it can run against a development
  database.

### Logging

Effect code logs with `Effect.logInfo` / `Effect.logError` and is timed by its `Effect.fn` spans; code outside Effect
logs through `createLogger`, never `console`. The rules, the request line and how to read a slow request are in
[logging.md](./logging.md).

### Checks

- `pnpm typecheck` runs `effect-tsgo tsc`, TypeScript with the Effect language service's diagnostics
  (`tsconfig.json`). Warnings fail it too. Effect v3 APIs and an unstable Effect API outside `src/server/` are errors.
- `pnpm lint` runs `scripts/lint-effect.mjs` on every feature's `service.ts`, `repository.ts` and `jobs.server.ts`:
  no `async`/`await`, no `throw`/`try`, no running Effects, and no `#/paraglide/messages`. Each message says what to
  write instead.
- oxlint refuses the libraries the backend replaced (`.oxlintrc.json` → `no-restricted-imports`): `zod`, `pino`,
  `pg-boss`, `dotenv`, and the v3 packages `@effect/schema`, `@effect/platform` and `@effect/sql`.

## Naming

- Contracts: `<feature>Contract`; procedures: `<action><Thing>Procedure`.
- Services: `<Feature>Service` with domain verbs (`NoteService.add`, `MediaService.attach`); repositories:
  `<Feature>Repo` with storage verbs (`NoteRepo.insert`, `MediaRepo.findById`). Their keys are
  `"app/orpc/<feature>/<Name>"`; platform services' are `"app/server/<Name>"`.
- Spans: `Effect.fn("<Class>.<method>")`, with the class's name: the `Service.` and `Repo.` endings decide the kind.
- Errors: tagged errors named for the fact (`NoteNotFound`, `MediaUnusable`); contract error collections:
  `<thing>Errors`; error codes: `UPPER_SNAKE_CASE`.
- Jobs: `<feature>.<verb>` queue names (`media.discard`), exported as `<Verb><Thing>` (`DiscardMedia`).
- Router keys are camelCase feature names; feature folders are kebab-case.
