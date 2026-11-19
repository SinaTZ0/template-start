import { SendMail } from "#/mail/jobs.server";
import { CleanupMedia, DiscardMedia } from "#/orpc/media/jobs.server";

/*===== Jobs =====*/
/**
 * Every job the app runs (docs/backend/jobs.md), each by a worker fiber on the app's runtime. A job that isn't listed
 * here can still be queued, but nothing runs it: add each new one.
 */
export const jobs = [DiscardMedia, CleanupMedia, SendMail];
