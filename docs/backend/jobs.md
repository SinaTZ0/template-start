# Background Jobs

Work that shouldn't run inside a request goes to a job: it's slow (sending mail, calling another service), it talks
to something that may be down and should be tried again, or it runs on a schedule. The queue is Effect's persisted
queue (`effect/persistence/PersistedQueue`) with its SQL store, which keeps the jobs in this app's Postgres, in a table
of its own (`effect_queue`). That buys three things:

- **No other service.** No Redis to run, back up or watch. The database dumps hold the queue.
- **A job can be queued in a transaction.** The queue's store uses the app's own pool (`PgLive`), so "delete the note
  and queue the deletion of its image" either both happen or neither does. With a queue outside the database, a crash
  between the two leaves one without the other.
- **Retries are the queue's.** A failed run is tried again after a growing wait, from whichever process takes it.

The code is `src/server/jobs.server.ts`. The two jobs of the media feature are the worked examples
(`src/orpc/media/jobs.server.ts`): `media.discard`, queued by a request, and `media.cleanup`, on a schedule. Every
email goes through one more, `mail.send` ([mail.md](./mail.md)).

## Declaring a Job

A job lives next to its feature's service, in `src/orpc/<feature>/jobs.server.ts`:

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

| Field           | What it is                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `name`          | The queue's name, `<feature>.<what-it-does>`. Never reuse one for a different payload.          |
| `payload`       | An Effect Schema of plain data. Encoded when the job is queued and decoded when it runs.        |
| `run`           | The work: an Effect that may use any service in `AppLayer`. A failure or defect fails it.       |
| `maxAttempts`   | How many runs before giving up, the first included. 10 by default.                              |
| `retrySchedule` | The wait before each retry. By default it doubles from 1 s, up to 5 minutes.                    |
| `cron`          | Optional. A cron expression (`0 * * * *`) for a job that runs on a schedule, with payload `{}`. |

Then add it to the list in `src/jobs.server.ts`. A job that isn't listed can still be queued, but nothing runs it.

`jobs.server.ts` is checked like a service (`scripts/lint-effect.mjs`): no `async`/`await`, no `throw`, no running
Effects, no messages. A job that must not be retried catches its own failures, as `mail.send` does for a refusal for
good.

Rules for `run`:

- **It must be safe to run twice.** A run cut off by a crash, or one whose result didn't reach the queue, is run
  again. `media.discard` shows the pattern: it reads the row first and does nothing when it's gone.
- **Keep the payload small and stable.** IDs, not rows: the job reads the current state when it runs. A queued job
  can outlive a deploy, so a payload that changes shape gets a new job name instead.
- **Check that the work is still wanted.** Things change between queueing and running. `media.discard` leaves a media
  alone when something attached it again.
- **Keep it short.** Jobs run in the app's process (Where Jobs Run below). Work that takes minutes of CPU belongs in
  a process of its own.

## Queueing a Job

<!-- prettier-ignore -->
```ts
yield* DiscardMedia.enqueue({ mediaId }).pipe(Effect.provideService(Jobs, jobs));
```

`enqueue` returns an Effect that needs the `Jobs` service. A service yields `Jobs` once when its layer is built and
provides it here, so its methods keep needing nothing (`MediaService.release`). Inside `db.transaction(…)` the queued
row is part of that transaction: the job exists the moment the transaction commits and never if it rolls back.
Nothing is passed for this; the queue's statements join the transaction the way a repository's do.
`MediaService.release` marks the media unattached and queues its deletion, and an entity's service calls it inside
its own transaction (`NoteService.edit` and `NoteService.remove` in `src/orpc/note/service.ts`).

Outside a transaction the job is queued at once, on its own. That's right only when nothing else has to commit with
it.

| Option        | What it does                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------- |
| `id`          | Makes queueing idempotent: a second job with the same ID isn't queued while the first exists. |
| `deduplicate` | How long `id` stays taken: until the finished row is cleaned up (default), or until it ran.   |
| `delay`       | Waits this long before the job may run (`"10 minutes"`).                                      |

A queued job starts within about a second, which is how often the workers ask the queue for work.

## Scheduled Jobs

A job with `cron` is queued on that schedule, in the server process's time zone, with the payload `{}`:

```ts
export const CleanupMedia = defineJob({
  name: "media.cleanup",
  payload: Schema.Struct({}),
  cron: "0 * * * *",
  // The next hour's run goes over the same uploads, so a failed run isn't worth repeating.
  maxAttempts: 1,
  run: () => deleteOrphanedMedia().pipe(…),
});
```

Each server process queues it at those times, with the job's name as its `id` and `deduplicate: "untilExecuted"`, so
however many processes run, one run is waiting or going at most, and a run that takes longer than its interval isn't
joined by the next. The schedule lives in the code: changing or removing `cron` takes effect when the server restarts.
Times that passed while the app was down are skipped. A tick that can't be queued (the database briefly down) is
logged as an error and the schedule goes on.

`deploy/deploy.sh schedule` is something else: cron on the server, for the deploy tool's own backups and checks
([deployment.md](../deployment.md) → Backups). App work goes here.

## Where Jobs Run

The server entry (`src/server.ts`) starts `runJobWorkers(jobs)` on the app's runtime: one fiber per listed job inside
the app's process, one run at a time per job. A run is claimed with a lock the worker refreshes while it runs, so a
long job isn't taken twice. A run whose process died is taken again once its lock expires, about two minutes later.
A run interrupted on purpose (the server stopping, a reload in development) is released at once without counting as
an attempt, and the next worker runs it again.

During a deploy the old and the new app container run side by side for a moment; both work the queue, and each run
still goes to one of them.

The queue creates its table (`effect_queue`, with `effect_queue_migrations` for its own upgrades) when the runtime is
built at startup; there's no migration to write, and `pnpm db:generate` doesn't see it. Starting the workers builds
the runtime, so a queue that can't create its table stops the server at startup with the reason, like a missing
setting.

A process that only queues (a test, a seed) builds the queue without workers. The integration tests therefore queue
jobs and never run them: test the work a job does, as `src/orpc/media/integration.test.ts` does with the queued row
and `src/mail/jobs.server.test.ts` with `SendMail.run` on a mailbox in memory, not the queue.

## When a Job Fails

Each run is a `job <name>` span of its own trace, with the job's ID and attempt, so its log lines and queries share one
`reqId` ([logging.md](./logging.md)). Its lines carry `module: "jobs"`, `job`, `jobId` and `attempt`, and the
`jobs.runs` metric counts each run by job and outcome.

| Log line                          | Level | Meaning                                                          |
| --------------------------------- | ----- | ---------------------------------------------------------------- |
| `job failed, will retry`          | warn  | A failed run that has attempts left.                             |
| `job failed, no attempts left`    | error | The last attempt. Like every error, it reaches the error viewer. |
| `could not queue a scheduled job` | error | A `cron` tick failed; the next tick tries again.                 |

Finished jobs are kept for three days, failed ones for 30, then the queue's hourly cleanup deletes them
(`layerCleanup` in `src/server/jobs.server.ts`). A failed job keeps its last error in `last_failure`:

```sql
select queue_name, state, attempts, created_at, last_failure from effect_queue
where state = 'failed' order by created_at desc limit 20;
```

On a server, `deploy/deploy.sh pgweb open` opens a database browser for that ([deploy-tool.md](../deploy-tool.md) →
Database Browser). To run a failed job again, queue it again; nothing replays it by itself.
