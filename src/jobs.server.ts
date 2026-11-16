import type { RegisteredJob } from "#/lib/jobs.server";
import { sendMailJob } from "#/mail/jobs.server";
import { cleanupMediaJob, discardMediaJob } from "#/orpc/media/jobs.server";

/*===== Jobs =====*/
/**
 * Every job the app runs (docs/backend/jobs.md). A job that isn't listed here can still be queued, but nothing runs
 * it: add each new one.
 */
export const jobs: RegisteredJob[] = [discardMediaJob, cleanupMediaJob, sendMailJob];
