import { Context, Effect, Layer, Metric, References } from "effect";
import { Schedule } from "effect";
import type { Duration, Schema } from "effect";
import * as PersistedQueue from "effect/persistence/PersistedQueue";

import { jobRuns } from "#/server/observability/metrics.server";

/*===== Jobs =====*/
// Background work on Effect's persisted queue, stored in the app's own Postgres (docs/backend/jobs.md). A job is
// queued by a request (or another job) and run by a worker fiber in the server process, with retries on a schedule.
// Delivery is at least once: a worker that dies mid-run leaves the job to be run again, so every job must be safe to
// run twice.

/** A payload schema the queue can store without services: plain data in, plain data out. */
type PayloadSchema = Schema.Constraint & { readonly DecodingServices: never; readonly EncodingServices: never };

export type JobDefinition<S extends PayloadSchema, R> = {
  /** Unique, stable across deploys: queued rows are found by it. `<feature>.<verb>`, e.g. `media.discard`. */
  readonly name: string;
  readonly payload: S;
  /** The work. A failure or defect is retried until `maxAttempts`; a job that must not retry catches its errors. */
  readonly run: (payload: S["Type"]) => Effect.Effect<void, unknown, R>;
  /** Runs before giving up, the first included. Defaults to 10. */
  readonly maxAttempts?: number;
  /** The delay before each retry. Defaults to exponential from 1 s, capped at 5 minutes. */
  readonly retrySchedule?: Schedule.Schedule<unknown, number>;
  /**
   * Also queues a run on this schedule (cron syntax, the server's time zone), with the payload `{}`. The run is queued
   * under the job's name as its ID, so however many server processes schedule it, one run is waiting or going at most.
   */
  readonly cron?: string;
};

export type Job<S extends PayloadSchema, R> = JobDefinition<S, R> & {
  /**
   * Queues a run. Inside a `Db.transaction` the queued row is part of that transaction: it runs if the transaction
   * commits and never exists if it rolls back.
   *
   * @param id Makes the queueing idempotent: a second run with the same ID isn't queued while the first is waiting.
   * @param deduplicate How long `id` stays taken: until the run is cleaned up (default), or until it has run.
   */
  readonly enqueue: (
    payload: S["Type"],
    options?: {
      readonly id?: string;
      readonly delay?: Duration.Input;
      readonly deduplicate?: "untilExecuted" | "untilRemoved";
    },
  ) => Effect.Effect<void, never, Jobs>;
};

/**
 * A job of any payload, as listed for the workers (`src/jobs.server.ts`). `run` takes `never` because each job only
 * ever receives payloads its own schema decoded.
 */
export type RunnableJob<R> = Omit<JobDefinition<PayloadSchema, R>, "run"> & {
  readonly run: (payload: never) => Effect.Effect<void, unknown, R>;
  readonly enqueue: (
    payload: never,
    options?: Parameters<Job<PayloadSchema, R>["enqueue"]>[1],
  ) => Effect.Effect<void, never, Jobs>;
};

/** Defines a job. List it in `src/jobs.server.ts` so a worker runs it. */
export function defineJob<S extends PayloadSchema, R>(definition: JobDefinition<S, R>): Job<S, R> {
  return {
    ...definition,
    enqueue: (payload, options) =>
      Jobs.use((jobs) => jobs.queue(definition)).pipe(
        Effect.flatMap((queue) => queue.offer(payload, options)),
        // The queue failing to store a row is the database failing: a defect, like a failed query.
        Effect.orDie,
        Effect.asVoid,
        Effect.withSpan("Jobs.enqueue", { attributes: { "job.name": definition.name } }),
      ),
  };
}

/*===== Queues =====*/
type Queue<S extends PayloadSchema> = PersistedQueue.PersistedQueue<S["Type"]>;

/** What a job's queue is made from. */
type QueueSettings<S extends PayloadSchema> = Pick<
  JobDefinition<S, unknown>,
  "name" | "payload" | "maxAttempts" | "retrySchedule"
>;

/** The named queues of the app's jobs, one per job, made on first use. */
export class Jobs extends Context.Service<
  Jobs,
  { readonly queue: <S extends PayloadSchema>(job: QueueSettings<S>) => Effect.Effect<Queue<S>> }
>()("app/server/Jobs") {
  /** Needs the app's `SqlClient` (`PgLive`). Creates its table on first start. */
  static readonly layer = Layer.effect(
    Jobs,
    Effect.gen(function* () {
      const factory = yield* PersistedQueue.PersistedQueueFactory;
      const queues = new Map<string, Queue<PayloadSchema>>();
      return Jobs.of({
        queue: <S extends PayloadSchema>(job: QueueSettings<S>) =>
          Effect.suspend(() => {
            const cached = queues.get(job.name) as Queue<S> | undefined;
            if (cached) return Effect.succeed(cached);
            return factory
              .make({
                name: job.name,
                schema: job.payload,
                maxAttempts: job.maxAttempts,
                retrySchedule: job.retrySchedule,
              })
              .pipe(Effect.tap((queue) => Effect.sync(() => queues.set(job.name, queue as Queue<PayloadSchema>))));
          }),
      });
    }),
  ).pipe(
    Layer.provide(PersistedQueue.layer),
    // Finished rows are kept a few days to look at, failed ones a month; then the cleanup deletes them.
    Layer.provideMerge(PersistedQueue.layerCleanup({ timeToLive: "3 days", failedTimeToLive: "30 days" })),
    Layer.provide(PersistedQueue.layerStoreSql({ pollInterval: "1 second" })),
    // A store that can't create its table is the database failing at startup.
    Layer.orDie,
  );
}

/*===== Workers =====*/
/**
 * Runs each job's queue in its own fiber for as long as the runtime lives, one run at a time per job. A run is a
 * `job <name>` span with its attempt. A failure with attempts left is a warning; the last one is an error, which is
 * reported to the error viewer.
 */
export function runJobWorkers<R>(jobs: ReadonlyArray<RunnableJob<R>>) {
  return Effect.forEach(
    jobs,
    (job) =>
      Effect.gen(function* () {
        const queue = yield* Jobs.use((all) => all.queue(job));
        const maxAttempts = job.maxAttempts ?? 10;
        const runs = (outcome: "success" | "retry" | "failed") =>
          jobRuns.pipe(Metric.withAttributes({ job: job.name, outcome }), Metric.update(1));
        const runOnce = queue.take((payload, { id, attempts }) =>
          job.run(payload as never).pipe(
            Effect.tap(() => runs("success")),
            Effect.tapCause((cause) =>
              attempts >= maxAttempts
                ? Effect.logError("job failed, no attempts left", cause).pipe(Effect.andThen(runs("failed")))
                : Effect.logWarning("job failed, will retry", cause).pipe(Effect.andThen(runs("retry"))),
            ),
            Effect.withSpan(`job ${job.name}`, {
              kind: "consumer",
              root: true,
              attributes: { "job.id": id, "job.attempt": attempts },
            }),
            // Traced again inside the run (see `untraced` below).
            Effect.provideService(References.TracerEnabled, true),
            Effect.annotateLogs({ module: "jobs", job: job.name, jobId: id, attempt: attempts }),
          ),
        );
        // The queue polls its table about once a second per job, and each poll would be a trace of its own: hundreds
        // of thousands a day of empty ones, burying the requests in the trace backend. Only a run is traced.
        const untraced = Effect.provideService(References.TracerEnabled, false);
        /*------ Schedule ------*/
        if (job.cron) {
          // A scheduled job's payload is `{}`.
          yield* job.enqueue({} as never, { id: job.name, deduplicate: "untilExecuted" }).pipe(
            // One tick failing (the database briefly down) must not end the schedule.
            Effect.catchCause((cause) => Effect.logError("could not queue a scheduled job", cause)),
            Effect.schedule(Schedule.cron(job.cron)),
            Effect.provideService(Jobs, yield* Jobs),
            Effect.forkScoped,
          );
        }

        // A failed run is already recorded by the queue (retried or marked failed) and logged above.
        return yield* runOnce.pipe(untraced, Effect.ignoreCause, Effect.forever);
      }).pipe(Effect.forkScoped),
    { discard: true },
  );
}
