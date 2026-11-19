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
  (`src/orpc/effect.server.ts`), the server entry, the job worker, seeds and tests, plus the server routes outside
  oRPC (`/healthz`, `/api/auth/*`, `/robots.txt`, `/sitemap.xml`) and Better-Auth's callbacks
  (`src/server/auth.server.ts`). Inside Effect code, compose with `yield*`.
- **Unstable modules are wrapped once.** `effect/sql`, `effect/persistence`, `effect/observability` and
  `ErrorReporter` are `@stability unstable` and may break in a minor release. Use them only inside `src/server/`; the
  rest of the code goes through that wrapper.

## This Project's Patterns

Short templates, copied from the `note` and `media` features. Copy the shape from the real file, not from memory.

### A Domain Error (`src/orpc/note/errors.ts`)

```ts
import { Schema } from "effect";

/** No note with this ID belongs to the user. Another user's note looks the same as a missing one. */
export class NoteNotFound extends Schema.TaggedError<NoteNotFound>()("NoteNotFound", { id: Schema.String }) {}
```

Facts only: the procedure that receives it writes the message. The errors every procedure may meet (`Unauthorized`,
`Forbidden`, `InvalidInput`, `RateLimited`, `CaptchaFailed`) are in `src/server/errors.ts`.

### A Repository Method (`src/orpc/note/repository.ts`)

```ts
export class NoteRepo extends Context.Service<
  NoteRepo,
  {
    /** Finds a note only when it belongs to the owner, so another user's note looks the same as a missing one. */
    readonly findOwned: (args: { id: string; ownerId: string }) => Effect.Effect<Option.Option<NoteWithImage>>;
    // …
  }
>()("app/orpc/note/NoteRepo") {
  static readonly layer = Layer.effect(
    NoteRepo,
    Effect.gen(function* () {
      const { q } = yield* Db;

      const findOwned = Effect.fn("NoteRepo.findOwned")(function* ({ id, ownerId }: { id: string; ownerId: string }) {
        const [row] = yield* q
          .select({ note, image: media })
          .from(note)
          .leftJoin(media, eq(note.imageMediaId, media.id))
          .where(and(eq(note.id, id), eq(note.ownerId, ownerId)))
          .limit(1);
        return Option.fromNullishOr(row);
      }, Effect.orDie);

      return NoteRepo.of({ findOwned /* , … */ });
    }),
  );
}
```

A Drizzle query is an Effect (`yield* q.select()…`). Every method ends in `Effect.orDie`, passed to `Effect.fn`, so a
failed query is a defect and the method's error type stays `never`. A query inside a `db.transaction` joins it without
being passed a `tx`.

### A Service Method with a Transaction (`src/orpc/note/service.ts`)

```ts
// Inside `NoteService.layer`'s `Effect.gen`, after `const db = yield* Db; const notes = yield* NoteRepo; …`
const decodeFields = decodeInput(NoteFields);

const add = Effect.fn("NoteService.add")(function* ({ ownerId, input }: { ownerId: string; input: unknown }) {
  const { title, body = "", imageMediaId } = yield* decodeFields(input);
  const image = imageMediaId || null;

  return yield* db.transaction(
    Effect.gen(function* () {
      if (image) yield* mediaService.attach({ mediaId: image, kind: "image", userId: ownerId });
      const record = yield* notes.insert({ ownerId, title, body, imageMediaId: image });
      return yield* publicNote(record);
    }),
  );
});
```

`decodeInput` (`src/server/errors.ts`) checks the input against the feature's domain schema (`validation.ts`) and
fails with `InvalidInput`, which holds the schema issue; the boundary turns it into field messages. A typed failure
inside `db.transaction` (`MediaUnusable` from `attach`) rolls it back and keeps its type. The service's interface
declares each method's errors: `Effect.Effect<Note, InvalidInput | MediaUnusable>`.

### A Procedure (`src/orpc/note/procedure.ts`)

```ts
/** The picked image can't be used: shown under the image field. Called by the error map, in the request's locale. */
const imageUnusable = () => ({ errors: [], fields: { imageMediaId: m.note_error_image_unusable() } });

export const updateNoteProcedure = effectProcedure(base.note.update, {
  access: "user",
  run: ({ input: { id, ...fields } }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      return yield* (yield* NoteService).edit({ ownerId: user.id, id, input: fields });
    }),
  errors: {
    NoteNotFound: ({ errors }) => errors.NOT_FOUND({ data: noErrorData }),
    MediaUnusable: ({ errors }) => errors.INVALID_INPUT({ data: imageUnusable() }),
  },
});
```

`access` is `"user"` or a list of roles (`["admin"]`); left out, the procedure is public and its Effect can't require
`CurrentUser`. `errors` needs a key for every tagged error `run` can fail with, except the common ones
`effectProcedure` maps itself, so a new failure doesn't compile until each procedure says what the client sees. The
contract must declare each code used (`errors.NOT_FOUND` needs `NOT_FOUND` in the contract's `.errors`). Optional:
`rateLimit` (a stricter policy, `src/orpc/media/procedure.ts`) and `captcha: true`.

### A Job (`src/orpc/media/jobs.server.ts`)

```ts
export const DiscardMedia = defineJob({
  name: "media.discard",
  payload: Schema.Struct({ mediaId: Schema.String }),
  run: Effect.fn("MediaJobs.discard")(function* ({ mediaId }: { readonly mediaId: string }) {
    if (!isMediaId(mediaId)) return;
    const found = yield* (yield* MediaRepo).findById(mediaId);
    if (Option.isNone(found) || found.value.attachedAt) return;
    yield* deleteMedia(mediaId);
  }),
});
```

List every job in `src/jobs.server.ts`, or no worker runs it. Queue it with `yield* DiscardMedia.enqueue({ mediaId })`;
inside a `db.transaction` the queued row is part of the transaction. Delivery is at least once, so `run` must be safe
to run twice (here: it checks the row again). A scheduled job adds `cron` and gets the payload `{}`
(`CleanupMedia`, same file). `defineJob` is in `src/server/jobs.server.ts`.

### A Test on the App's Layers (`src/orpc/note/integration.test.ts`)

```ts
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
/** Runs an Effect that must fail, and returns its error. */
const failure = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(Effect.flip(effect));
const notes = <A, E>(f: (service: NoteService["Service"]) => Effect.Effect<A, E>) => NoteService.use(f);

afterAll(async () => {
  // … delete the rows this run created
  await runtime.dispose();
});

it("lets only the owner delete a note", async () => {
  const { id } = await run(notes((s) => s.add({ ownerId: owner, input: { title: "حذف‌شدنی" } })));

  expect(await failure(notes((s) => s.remove({ ownerId: stranger, id })))).toBeInstanceOf(NoteNotFound);
  await run(notes((s) => s.remove({ ownerId: owner, id })));
});
```

The services run on the app's real layers (`AppLayer`, `src/server/runtime.server.ts`) against the database in
`DATABASE_URL`, after `pnpm db:migrate`. Assert on the tagged error's class, never on message text. A test is a
boundary, so it may run Effects.

## Common Mistakes

- **`yield` without `*`** in `Effect.gen` / `Effect.fn` yields the Effect object itself. Always `yield*`.
- **A floating Effect** (`Effect.log("x")` as a statement) never runs. Yield it.
- **`Effect.catch` doesn't catch defects.** A thrown exception inside `Effect.sync` / `Effect.promise` is a defect;
  use `Effect.try` / `Effect.tryPromise` with a `catch` that builds a tagged error when the failure is expected.
- **Wrapping `Effect.gen` in a function that only returns it.** Use `Effect.fn` instead.
- **`Schema.optionalKey` in input schemas.** It means "the key may be missing", and it rejects a key present with
  `undefined`, which loaders and forms pass (`{ cursor: undefined }`), though JSON never shows it. Use
  `Schema.optional` for optional input fields; `optionalKey` only where `undefined` must be refused.
- **Effect's default `ConfigProvider` in a Vite build.** It merges `import.meta.env` over `process.env`, and Vite
  freezes `import.meta.env` at build time. Settings are read through `serverEnv` (`#/server/config.server`), which
  reads the process's environment only.
- **A transforming schema in a contract.** oRPC validates a procedure's output by running it through the contract's
  schema, so a `PersianText` or a `decodeTo` there changes what the client receives. Contract schemas are
  structure-only `standardSchema(...)`; normalizing and limits belong to the feature's `validation.ts`, decoded in the
  service with `decodeInput`.
- **Reading `AsyncLocalStorage` inside a fiber.** Request facts reach Effect code through the `RequestContext`
  service, read once at the boundary.
