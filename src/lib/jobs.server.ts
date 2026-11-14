import { performance } from "node:perf_hooks";

import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss } from "pg-boss";
import type { z } from "zod";

import { db } from "#/db/client.server";
import type { Database } from "#/db/client.server";
import { createLogger } from "#/lib/logger.server";
import { runWithTrace } from "#/lib/trace.server";

const log = createLogger("jobs");

/*===== Background Jobs =====*/
// Work that shouldn't run inside a request (docs/backend/jobs.md): it's slow, it talks to something that may be down
// and should be retried, or it runs on a schedule. The queue is pg-boss, whose tables live in this database's `pgboss`
// schema, so a job can be queued in the same transaction as the rows it's about, and the backups hold the queue.

/*------ Defaults ------*/
/** A failed run is tried again this many times, each wait about twice the last (2 s, 4 s, 8 s, …). */
const DEFAULT_RETRY_LIMIT = 5;
/**
 * A run still going after this long is taken to be lost (the server restarted under it) and is started again. Far
 * above what a job here takes; a job that needs longer sets its own.
 */
const DEFAULT_EXPIRE_SECONDS = 5 * 60;
/** Finished jobs are kept this long, to look at when something went wrong. */
const KEEP_FINISHED_SECONDS = 3 * 24 * 60 * 60;

/*===== Definition =====*/
type JobSpec<Schema extends z.ZodType<object>> = {
  /** The queue's name, `<feature>.<what-it-does>` (`media.discard`). Never reuse a name for another payload. */
  name: string;
  /** The payload. Checked when the job is queued and again when it runs, since a queued job can outlive a deploy. */
  schema: Schema;
  /**
   * Does the work. It must be safe to run twice for the same payload: a run that was interrupted, or whose result
   * didn't reach the queue, is started again. Throwing fails the run, which is retried up to `retryLimit` times.
   */
  run: (data: z.infer<Schema>) => Promise<void>;
  /** A cron expression (`0 * * * *`, in UTC) for a job that runs on a schedule, with an empty payload. */
  cron?: string;
  retryLimit?: number;
  expireInSeconds?: number;
};

/** A job without its payload's type: what the registry (`src/jobs.server.ts`) and the workers hold. */
export type RegisteredJob = Pick<
  JobSpec<z.ZodType<object>>,
  "name" | "schema" | "cron" | "retryLimit" | "expireInSeconds"
> & {
  run: (data: never) => Promise<void>;
};

export type Job<Schema extends z.ZodType<object>> = JobSpec<Schema> & {
  /**
   * Queues one run. With `db` set to a transaction, the job is queued only if that transaction commits, and exists
   * the moment it does: use it whenever the job follows from rows written there.
   */
  enqueue: (input: { data: z.infer<Schema>; db?: Database }) => Promise<void>;
};

/**
 * Declares a job. Keep it next to the feature's service (`src/orpc/<feature>/jobs.server.ts`) and add it to
 * `src/jobs.server.ts`, which is what makes the app run it.
 */
export function defineJob<Schema extends z.ZodType<object>>(spec: JobSpec<Schema>): Job<Schema> {
  const job: Job<Schema> = {
    ...spec,
    async enqueue({ data, db: transaction }) {
      const payload = spec.schema.parse(data);
      const boss = await started();
      await ensureQueue(boss, job);
      await boss.send(spec.name, payload, transaction ? { db: fromDrizzle(transaction, sql) } : undefined);
    },
  };
  return job;
}

/*===== The Queue =====*/
// Kept on `globalThis`: Vite re-evaluates server modules on every change in development, and a second instance would
// poll the same queues beside the first.
const BOSS = Symbol.for("app.jobs.boss");
const QUEUES = Symbol.for("app.jobs.queues");
const HANDLERS = Symbol.for("app.jobs.handlers");
const state = globalThis as typeof globalThis & {
  [BOSS]?: Promise<PgBoss>;
  [QUEUES]?: Set<string>;
  [HANDLERS]?: Map<string, RegisteredJob>;
};

/**
 * Starts pg-boss on the app's own connection pool, so the queue adds no connections. The first start of a database
 * creates the `pgboss` schema. `work` is whether this process runs jobs: without it (a test, a script) it only queues
 * them, and keeps no timers that would hold the process open.
 */
function start({ work }: { work: boolean }): Promise<PgBoss> {
  const boss = new PgBoss({
    db: { executeSql: (text, values) => db.$client.query(text, values) },
    schema: "pgboss",
    supervise: work,
    schedule: work,
  });
  // Without a listener, an error event would end the process.
  boss.on("error", (error) => log.error({ err: error }, "the job queue failed"));
  boss.on("warning", (warning) => log.warn({ warning }, "job queue warning"));
  return boss.start();
}

/** The queue, started on first use. A process that never called `startJobs` gets one that only queues. */
function started(): Promise<PgBoss> {
  return (state[BOSS] ??= start({ work: false }));
}

function queueOptions(job: RegisteredJob) {
  return {
    retryLimit: job.retryLimit ?? DEFAULT_RETRY_LIMIT,
    retryDelay: 2,
    retryBackoff: true,
    expireInSeconds: job.expireInSeconds ?? DEFAULT_EXPIRE_SECONDS,
    deleteAfterSeconds: KEEP_FINISHED_SECONDS,
  };
}

/** Creates the job's queue once per process; creating one that exists changes nothing. */
async function ensureQueue(boss: PgBoss, job: RegisteredJob): Promise<void> {
  const known = (state[QUEUES] ??= new Set());
  if (known.has(job.name)) return;
  await boss.createQueue(job.name, {
    ...queueOptions(job),
    // A scheduled job has one run waiting and one going at most: a slow run isn't joined by the next hour's.
    policy: job.cron ? "stately" : "standard",
  });
  known.add(job.name);
}

/*===== Running =====*/
/** One run of a job, in a trace of its own so its queries and log lines carry one ID, like a request's. */
async function runJob({ name, id, data, attempt }: { name: string; id: string; data: unknown; attempt: number }) {
  const job = state[HANDLERS]?.get(name);
  // Only after a deploy removed a job that still had runs queued.
  if (!job) throw new Error(`No job is registered as ${name}`);
  const retryLimit = job.retryLimit ?? DEFAULT_RETRY_LIMIT;

  await runWithTrace({ method: "JOB", path: name }, async () => {
    const begun = performance.now();
    try {
      await job.run(job.schema.parse(data ?? {}) as never);
      log.info({ job: name, jobId: id, ms: Math.round(performance.now() - begun) }, "job done");
    } catch (error) {
      // Only the last failure is an error (and reaches the error viewer): the earlier ones are what retries are for.
      if (attempt < retryLimit)
        log.warn({ err: error, job: name, jobId: id, attempt }, "job failed; it will be retried");
      else log.error({ err: error, job: name, jobId: id, attempt }, "job failed for the last time");
      throw error;
    }
  });
}

/**
 * Makes this process run the jobs: creates their queues, starts a worker for each and sets the schedules. Called once
 * from the server entry (`src/server.ts`). A failure to start is logged, not thrown: the app still serves, and jobs
 * queue up until a restart that can reach the queue.
 */
export function startJobs({ jobs }: { jobs: RegisteredJob[] }): void {
  // Looked up at each run, so an edited handler is the one that runs after Vite reloads it.
  state[HANDLERS] = new Map(jobs.map((job) => [job.name, job]));
  if (state[BOSS]) return;

  const boss = start({ work: true });
  state[BOSS] = boss;
  boss
    .then(async (queue) => {
      for (const job of jobs) {
        await ensureQueue(queue, job);
        // A queue made by an earlier deploy keeps its settings unless they're set again.
        await queue.updateQueue(job.name, queueOptions(job));
        await queue.work(job.name, { batchSize: 1 }, async ([run]) => {
          if (run) await runJob({ name: job.name, id: run.id, data: run.data, attempt: run.retryCount });
        });
        if (job.cron) await queue.schedule(job.name, job.cron);
      }
      // Schedules live in the database, so one whose job lost its `cron`, or was deleted, is removed here.
      for (const schedule of await queue.getSchedules()) {
        if (!state[HANDLERS]?.get(schedule.name)?.cron) await queue.unschedule(schedule.name);
      }
      log.info({ jobs: jobs.map((job) => job.name) }, "background jobs started");
    })
    .catch((error: unknown) => log.error({ err: error }, "background jobs could not start"));
}
