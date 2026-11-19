import { Context, Data, Effect, Layer, Redacted } from "effect";
import { createTransport } from "nodemailer";

import { AppConfig } from "#/server/config.server";

/*===== Mail =====*/
export type OutgoingMail = {
  to: string;
  /** The sender's display name, in the email's language. The address is always `MAIL_FROM`. */
  fromName: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * A failed delivery, as the logs and the error viewer may keep it. Nodemailer's own error carries the recipient (its
 * `rejected` list, often the server's reply too), and the logs keep what was sent, not to whom: this one has the
 * server's reply with every address in it masked, which is the part that says what went wrong.
 *
 * `permanent` when the server refused for good (a 5xx reply): an address that doesn't exist, a login it doesn't
 * accept, a daily limit reached. Sending again in a minute gets the same answer. A 4xx reply ("try later"), a timeout
 * or a dropped connection is temporary.
 */
export class MailDeliveryError extends Data.TaggedError("MailDeliveryError")<{
  readonly message: string;
  readonly permanent: boolean;
  /** The SMTP reply code, when the server answered (550, 421, 535…). */
  readonly responseCode: number | undefined;
  /** Nodemailer's code for what failed: `EAUTH`, `ECONNECTION`, `ETIMEDOUT`, `EENVELOPE`… */
  readonly code: string | undefined;
}> {}

function maskAddresses(text: string): string {
  return text.replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, "[address]");
}

function toDeliveryError(cause: unknown): MailDeliveryError {
  const { code, responseCode, command, response, message } = (cause ?? {}) as Partial<
    Record<"code" | "command" | "response" | "message", string> & { responseCode: number }
  >;
  // `||`, not `??`: a connection that failed before the server spoke has an empty `response`.
  const reply = maskAddresses(response || message || "unknown error");
  // `EENVELOPE during RCPT TO: 550 5.1.1 <[address]> Recipient address rejected`
  const where = [code, command && `during ${command}`].filter(Boolean).join(" ");
  return new MailDeliveryError({
    message: where ? `${where}: ${reply}` : reply,
    permanent: responseCode !== undefined && responseCode >= 500 && responseCode < 600,
    responseCode,
    code,
  });
}

/*===== Mailer =====*/
/**
 * One mailbox for the whole app (docs/backend/mail.md): Gmail with an app password, the domain host's mailbox, or
 * Mailpit in development. Not pooled: the app sends a few emails at a time, one at a time (`mail.send`), and a
 * connection held open between them would be closed by the provider anyway.
 */
export class Mailer extends Context.Service<
  Mailer,
  {
    /**
     * Hands one email to the mailbox's SMTP server. Succeeds once the server has accepted it, which is not delivery: a
     * bounce comes back later, to the mailbox's own inbox.
     */
    readonly send: (mail: OutgoingMail) => Effect.Effect<{ messageId: string }, MailDeliveryError>;
  }
>()("app/server/Mailer") {
  static readonly layer = Layer.effect(
    Mailer,
    Effect.gen(function* () {
      const { smtp } = yield* AppConfig;
      const transport = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        // A login is never sent in the clear: with credentials, a server that doesn't offer STARTTLS is refused.
        // Without them (Mailpit on this machine), plain SMTP is allowed.
        requireTLS: smtp.user !== "",
        auth: smtp.user ? { user: smtp.user, pass: Redacted.value(smtp.password) } : undefined,
        // Nodemailer waits up to 2 minutes for a silent server by default. A run that hangs that long holds the only
        // worker (`mail.send`), so give up sooner and let the retry try again.
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      });

      return Mailer.of({
        send: ({ to, fromName, subject, html, text }) =>
          Effect.tryPromise({
            try: () => transport.sendMail({ from: { name: fromName, address: smtp.from }, to, subject, html, text }),
            catch: toDeliveryError,
          }).pipe(
            Effect.map((info) => ({ messageId: info.messageId })),
            Effect.withSpan("Mailer.send"),
          ),
      });
    }),
  );

  /** A mailbox that keeps what it is given, for tests. */
  static layerMemory(sent: OutgoingMail[]) {
    return Layer.succeed(
      Mailer,
      Mailer.of({
        send: (mail) => Effect.sync(() => ({ messageId: `test-${sent.push(mail)}` })),
      }),
    );
  }
}
