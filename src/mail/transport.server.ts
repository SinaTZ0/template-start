import { createTransport } from "nodemailer";

import { env } from "#/env.server";

/*===== SMTP Transport =====*/
// One mailbox for the whole app (docs/backend/mail.md): Gmail with an app password, the domain host's mailbox, or
// Mailpit in development. Not pooled: the app sends a few emails at a time, one at a time (`mail.send`), and a
// connection held open between them would be closed by the provider anyway.
const transport = createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  // 465 is TLS from the first byte. Every other port starts plain and upgrades with STARTTLS.
  secure: env.SMTP_PORT === 465,
  // A login is never sent in the clear: with credentials, a server that doesn't offer STARTTLS is refused. Without them
  // (Mailpit on this machine), plain SMTP is allowed.
  requireTLS: env.SMTP_USER !== "",
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  // Nodemailer waits up to 2 minutes for a silent server by default. A job that hangs that long holds the only worker
  // (`mail.send`), so give up sooner and let the retry try again.
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 30_000,
});

export type OutgoingMail = {
  to: string;
  /** The sender's display name, in the email's language. The address is always `MAIL_FROM`. */
  fromName: string;
  subject: string;
  html: string;
  text: string;
};

/*===== Errors =====*/
/**
 * A failed delivery, as the logs and the error viewer may keep it. Nodemailer's own error carries the recipient (its
 * `rejected` list, often the server's reply too), and the logs keep what was sent, not to whom: this one has the
 * server's reply with every address in it masked, which is the part that says what went wrong.
 */
export class MailDeliveryError extends Error {
  override name = "MailDeliveryError";
  /** The SMTP reply code, when the server answered (550, 421, 535…). */
  readonly responseCode: number | undefined;
  /** Nodemailer's code for what failed: `EAUTH`, `ECONNECTION`, `ETIMEDOUT`, `EENVELOPE`… */
  readonly code: string | undefined;

  constructor(cause: unknown) {
    const { code, responseCode, command, response, message } = (cause ?? {}) as Partial<
      Record<"code" | "command" | "response" | "message", string> & { responseCode: number }
    >;
    const reply = maskAddresses(response ?? message ?? "unknown error");
    // `EENVELOPE during RCPT TO: 550 5.1.1 <[address]> Recipient address rejected`
    const where = [code, command && `during ${command}`].filter(Boolean).join(" ");
    super(where ? `${where}: ${reply}` : reply);
    this.code = code;
    this.responseCode = responseCode;
  }
}

function maskAddresses(text: string): string {
  return text.replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, "[address]");
}

/*===== Sending =====*/
/**
 * Hands one email to the mailbox's SMTP server. Resolves once the server has accepted it, which is not delivery: a
 * bounce comes back later, to the mailbox's own inbox.
 *
 * @throws {MailDeliveryError} when the server refused it or couldn't be reached.
 */
export async function deliverMail({ to, fromName, subject, html, text }: OutgoingMail): Promise<{ messageId: string }> {
  try {
    const info = await transport.sendMail({
      from: { name: fromName, address: env.MAIL_FROM },
      to,
      subject,
      html,
      text,
    });
    return { messageId: info.messageId };
  } catch (error) {
    throw new MailDeliveryError(error);
  }
}

/**
 * Whether the SMTP server refused for good (a 5xx reply): an address that doesn't exist, a login it doesn't accept, a
 * daily limit reached. Sending again in a minute gets the same answer. A 4xx reply ("try later"), a timeout or a
 * dropped connection is temporary.
 */
export function isPermanentMailError(error: MailDeliveryError): boolean {
  return error.responseCode !== undefined && error.responseCode >= 500 && error.responseCode < 600;
}
