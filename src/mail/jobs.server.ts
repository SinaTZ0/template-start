import { z } from "zod";

import { defineJob } from "#/lib/jobs.server";
import { createLogger } from "#/lib/logger.server";
import { MAIL_TEMPLATES, renderMail } from "#/mail/render.server";
import { deliverMail, isPermanentMailError, MailDeliveryError } from "#/mail/transport.server";
import { locales } from "#/paraglide/runtime";

const log = createLogger("mail");

/*===== Send Mail =====*/
/**
 * Renders one email and hands it to the mailbox (docs/backend/mail.md). Every email goes through here, never straight
 * from a request: the request doesn't wait on the mailbox, a mailbox that's down or says "slow down" is tried again,
 * and one worker per process sends one email at a time, which keeps a regular mailbox under its rate limits.
 *
 * The email is rendered when it's sent, from the template's current code. The payload holds the link, token included,
 * so the job row is as secret as the link: it's deleted with the other finished jobs (`KEEP_FINISHED_SECONDS`).
 *
 * Not exactly once: a run cut off after the server accepted the email but before the queue heard back is run again,
 * and the email arrives twice. Every email here is safe to receive twice.
 */
export const sendMailJob = defineJob({
  name: "mail.send",
  schema: z.object({
    template: z.enum(MAIL_TEMPLATES),
    to: z.email(),
    locale: z.enum(locales),
    name: z.string(),
    url: z.url(),
  }),
  // Retries wait about 2 s, 4 s, … 256 s: a mailbox that's down for up to eight minutes still delivers the email,
  // while its link still works.
  retryLimit: 8,
  run: async ({ to, ...mail }) => {
    const email = await renderMail(mail);
    try {
      const { messageId } = await deliverMail({ to, ...email });
      // Never the address or the link: the log keeps what was sent, not to whom.
      log.info({ template: mail.template, messageId }, "email sent");
    } catch (error) {
      // A refusal for good is logged (and reported) once instead of being retried into the same answer. The server's
      // reply says why: an unknown address, a rejected login (`SMTP_USER`, `SMTP_PASSWORD`), a daily limit.
      if (error instanceof MailDeliveryError && isPermanentMailError(error)) {
        log.error({ err: error, template: mail.template }, "the mail server refused the email");
        return;
      }
      throw error;
    }
  },
});

/** Queues one email. See `sendMailJob`. */
export function queueMail(data: z.infer<typeof sendMailJob.schema>): Promise<void> {
  return sendMailJob.enqueue({ data });
}
