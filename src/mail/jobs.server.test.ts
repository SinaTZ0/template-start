import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import { SendMail } from "#/mail/jobs.server";
import type { MailPayload } from "#/mail/jobs.server";
import { MailDeliveryError, Mailer } from "#/server/mailer.server";
import type { OutgoingMail } from "#/server/mailer.server";

/*===== Send Mail =====*/
// A mailbox that refuses for good must not be asked again and again; one that is briefly down must be.

const mail: MailPayload = {
  template: "verify-email",
  to: "someone@example.test",
  locale: "fa",
  name: "آزمون",
  url: "https://example.test/verify",
};

function refusingMailer(permanent: boolean) {
  return Layer.succeed(
    Mailer,
    Mailer.of({
      send: () =>
        Effect.fail(
          new MailDeliveryError({
            message: "refused",
            permanent,
            responseCode: permanent ? 550 : 421,
            code: "EENVELOPE",
          }),
        ),
    }),
  );
}

describe("mail.send", () => {
  it.effect("renders the email in its language and hands it to the mailbox", () =>
    Effect.gen(function* () {
      const sent: OutgoingMail[] = [];
      yield* SendMail.run(mail).pipe(Effect.provide(Mailer.layerMemory(sent)));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        to: mail.to,
        subject: expect.any(String),
        html: expect.stringContaining(mail.url),
      });
    }),
  );

  it.effect("gives up on a refusal for good, but fails a temporary one so the queue retries it", () =>
    Effect.gen(function* () {
      const permanent = yield* Effect.exit(SendMail.run(mail).pipe(Effect.provide(refusingMailer(true))));
      expect(Exit.isSuccess(permanent)).toBe(true);

      const temporary = yield* Effect.exit(SendMail.run(mail).pipe(Effect.provide(refusingMailer(false))));
      expect(Exit.isFailure(temporary)).toBe(true);
    }),
  );
});
