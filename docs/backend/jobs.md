# Background Jobs

Work that shouldn't run inside a request goes to a job: it's slow (sending mail, calling another service), it talks
to something that may be down and should be tried again, or it runs on a schedule. The queue is
[pg-boss](https://pgboss.io), which keeps its jobs in this app's Postgres, in a schema of its own (`pgboss`). That
buys three things:

- **No other service.** No Redis to run, back up or watch. The database dumps hold the queue.
- **A job can be queued in a transaction.** "Delete the note and queue the deletion of its image" either both happen
  or neither does. With a queue outside the database, a crash between the two leaves one without the other.
- **Retries and schedules are the queue's.** A failed run is tried again with a growing wait, and a schedule fires
  once however many app processes run.

The code is `src/lib/jobs.server.ts`. The two jobs of the media feature are the worked examples
(`src/orpc/media/jobs.server.ts`): `media.discard`, queued by a request, and `media.cleanup`, on a schedule. Every
email goes through one more, `mail.send` ([mail.md](./mail.md)).

## Declaring a Job

A job lives next to its feature's service, in `src/orpc/<feature>/jobs.server.ts`:

```ts
export const discardMediaJob = defineJob({
  name: "media.discard",
  schema: z.object({ mediaId: z.guid() }),
  run: ({ mediaId }) => deleteReleasedMedia({ db, mediaId }),
});
```

| Field             | What it is                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `name`            | The queue's name, `<feature>.<what-it-does>`. Never reuse one for a different payload.             |
| `schema`          | The payload, an object. Checked when the job is queued and again when it runs.                     |
| `run`             | The work. Calls a service, like a procedure does; throwing fails the run.                          |
| `cron`            | Optional. A cron expression in UTC (`0 * * * *`) for a job that runs on a schedule, without data.  |
| `retryLimit`      | How many times a failed run is tried again. 5 by default, waiting about 2 s, 4 s, 8 s, 16 s, 32 s. |
| `expireInSeconds` | A run still going after this long counts as lost and is started again. 5 minutes by default.       |

Then add it to the list in `src/jobs.server.ts`. A job that isn't listed can still be queued, but nothing runs it.

Rules for `run`:

- **It must be safe to run twice.** A run interrupted by a restart, or one whose result didn't reach the queue, is
  started again. `deleteReleasedMedia` shows the pattern: it reads the row first and does nothing when it's gone.
- **Keep the payload small and stable.** IDs, not rows: the job reads the current state when it runs. A queued job
  can outlive a deploy, so a payload that changes shape gets a new job name instead.
- **Check that the work is still wanted.** Things change between queueing and running. `deleteReleasedMedia` leaves
  a media alone when something attached it again.
- **Keep it short.** Jobs run in the app's process (Where Jobs Run below). Work that takes minutes of CPU belongs in
  a process of its own.

## Queueing a Job

```ts
await discardMediaJob.enqueue({ data: { mediaId }, db: tx });
```

Pass `db` the transaction that writes the rows the job follows from. The job then exists the moment that transaction
commits and never if it rolls back. `releaseMedia` (`src/orpc/media/jobs.server.ts`) does this: it marks the media
unattached and queues its deletion together, and an entity's service calls it inside its own transaction
(`removeNote` and `editNote` in `src/orpc/note/service.ts`).

Without `db` the job is queued at once, on its own. That's right only when nothing else has to commit with it.

A queued run starts within about two seconds, which is how often the workers ask the queue for work.

## Scheduled Jobs

A job with `cron` is queued by pg-boss at those times, in UTC, with an empty payload:

```ts
export const cleanupMediaJob = defineJob({
  name: "media.cleanup",
  schema: z.object({}),
  cron: "0 * * * *",
  retryLimit: 0,
  expireInSeconds: 30 * 60,
  run: async () => { … },
});
```

The schedule is kept in the database and set again at each start, so changing `cron` in the code changes it, and
removing `cron` or the job removes it. A scheduled job never has more than one run going and one waiting: a run that
takes longer than its interval isn't joined by the next. Times that passed while the app was down are skipped.

`deploy/deploy.sh schedule` is something else: cron on the server, for the deploy tool's own backups and checks
([deployment.md](../deployment.md) → Backups). App work goes here.

## Where Jobs Run

`startJobs` (`src/server.ts`) starts a worker for every listed job inside the app's process, one run at a time per
job. During a deploy the old and the new app container run side by side for a moment; both work the queue, and each
run still goes to one of them. A run the old container was in the middle of when it stopped is started again once
its `expireInSeconds` has passed.

pg-boss uses the app's own connection pool, so the queue adds no database connections. It creates and upgrades the
`pgboss` schema itself when the app starts; there's no migration to write, and `pnpm db:generate` doesn't see it.

A process that only queues (a test, a script) starts the queue on its first `enqueue`, without workers. The
integration tests therefore queue jobs and never run them: test the service a job calls, as
`src/orpc/media/integration.test.ts` does, not the queue.

## When a Job Fails

Each run has its own trace, so its log lines and queries carry one `reqId` ([logging.md](./logging.md)):

| Log line                          | Level | Meaning                                                             |
| --------------------------------- | ----- | ------------------------------------------------------------------- |
| `job done`                        | info  | With the job's name, its ID and how long it took.                   |
| `job failed; it will be retried`  | warn  | A failed run that has tries left.                                   |
| `job failed for the last time`    | error | No tries left. Like every error, it reaches the error viewer.       |
| `background jobs could not start` | error | The queue didn't start; the app serves, and jobs wait in the queue. |

Finished jobs stay for three days, failed ones included, with the error in `output`:

```sql
select name, state, retry_count, created_on, output from pgboss.job
where state = 'failed' order by created_on desc limit 20;
```

On a server, `deploy/deploy.sh pgweb open` opens a database browser for that ([deploy-tool.md](../deploy-tool.md) →
Database Browser). To run a failed job again, queue it again; nothing replays it by itself.
