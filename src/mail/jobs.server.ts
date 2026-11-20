import { Cause, Effect, Schedule, Schema } from "effect";

import { MAIL_TEMPLATES, renderMail } from "#/mail/render.server";
import { locales } from "#/paraglide/runtime";
import { defineJob } from "#/server/jobs.server";
import { Mailer } from "#/server/mailer.server";

/*===== Send Mail =====*/
const MailPayload = Schema.Struct({
  template: Schema.Literals(MAIL_TEMPLATES),
  to: Schema.String,
  locale: Schema.Literals(locales),
  name: Schema.String,
  url: Schema.String,
});

export type MailPayload = typeof MailPayload.Type;

/**
 * Renders one email and hands it to the mailbox (docs/backend/mail.md). Every email goes through here, never straight
 * from a request: the request doesn't wait on the mailbox, a mailbox that's down or says "slow down" is tried again,
 * and the one worker per process sends one email at a time, which keeps a regular mailbox under its rate limits.
 *
 * The email is rendered when it's sent, from the template's current code. The payload holds the link, token included,
 * so the queued row is as secret as the link: it's deleted with the other finished jobs a few days later.
 *
 * Not exactly once: a run cut off after the server accepted the email but before the queue heard back is run again,
 * and the email arrives twice. Every email here is safe to receive twice.
 */
export const SendMail = defineJob({
  name: "mail.send",
  payload: MailPayload,
  // Retries wait 2 s, 4 s, … 256 s: a mailbox that's down for up to eight minutes still delivers the email, while its
  // link still works.
  maxAttempts: 9,
  retrySchedule: Schedule.exponential("2 seconds"),
  run: Effect.fn("MailJobs.send")(function* ({ to, ...mail }: MailPayload) {
    const email = yield* Effect.promise(() => renderMail(mail));
    const mailer = yield* Mailer;
    const { messageId } = yield* mailer.send({ to, ...email }).pipe(
      // A refusal for good is reported once instead of being retried into the same answer. The server's reply says
      // why: an unknown address, a rejected login (`SMTP_USER`, `SMTP_PASSWORD`), a daily limit.
      Effect.catchIf(
        (error) => error.permanent,
        // As a cause, so the line carries the error and it is reported to the error viewer.
        (error) =>
          Effect.logError("the mail server refused the email", Cause.fail(error)).pipe(Effect.as({ messageId: "" })),
      ),
    );
    // Never the address or the link: the log keeps what was sent, not to whom.
    if (messageId) {
      yield* Effect.logInfo("email sent").pipe(Effect.annotateLogs({ template: mail.template, messageId }));
    }
  }),
});
