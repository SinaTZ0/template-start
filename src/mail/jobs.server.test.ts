import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

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
  it("renders the email in its language and hands it to the mailbox", async () => {
    const sent: OutgoingMail[] = [];
    await Effect.runPromise(SendMail.run(mail).pipe(Effect.provide(Mailer.layerMemory(sent))));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: mail.to,
      subject: expect.any(String),
      html: expect.stringContaining(mail.url),
    });
  });

  it("gives up on a refusal for good, but fails a temporary one so the queue retries it", async () => {
    const permanent = await Effect.runPromiseExit(SendMail.run(mail).pipe(Effect.provide(refusingMailer(true))));
    expect(permanent._tag).toBe("Success");

    const temporary = await Effect.runPromiseExit(SendMail.run(mail).pipe(Effect.provide(refusingMailer(false))));
    expect(temporary._tag).toBe("Failure");
  });
});
