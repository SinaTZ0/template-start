# Email

The app sends its own email through one ordinary mailbox over SMTP: a Gmail or Yahoo account, or the mailbox that
comes with the domain's hosting. No email service account. Nodemailer does the SMTP, React Email builds the HTML, the
text comes from the Paraglide messages in the recipient's language, and every email goes out through one queued job.

The code:

| File                          | What it is                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `src/server/mailer.server.ts` | `Mailer`: the SMTP connection from `AppConfig`, and `MailDeliveryError`           |
| `src/mail/templates/`         | One React Email component per email, the shared frame (`layout.tsx`), its colours |
| `src/mail/render.server.tsx`  | `TEMPLATES` and `renderMail`: subject, sender name, HTML and plain text           |
| `src/mail/jobs.server.ts`     | `SendMail`, the `mail.send` job that renders and sends one email                  |

The emails today are Better-Auth's (`src/server/better-auth.server.ts`): the sign-up confirmation (`verify-email`), the
password reset (`reset-password`), and the note to an address that signs up again (`account-exists`).

## The Mailbox

Set in `.env`, read into `AppConfig.smtp` (`src/server/config.server.ts`):

| Variable        | Development            | Production (Gmail)              |
| --------------- | ---------------------- | ------------------------------- |
| `SMTP_HOST`     | `localhost`            | `smtp.gmail.com`                |
| `SMTP_PORT`     | `1025`                 | `587` (or `465`)                |
| `SMTP_USER`     | empty                  | `myapp@gmail.com`               |
| `SMTP_PASSWORD` | empty                  | an app password, without spaces |
| `MAIL_FROM`     | `no-reply@example.com` | `myapp@gmail.com`               |

- **Port 465** is TLS from the first byte; **any other port** (587, the default) starts plain and upgrades with
  STARTTLS. With a login set, the transport refuses a server that doesn't offer STARTTLS, so the password never travels
  in the clear. The password is `Redacted`, so it never shows in a log line.
- **`MAIL_FROM` is just the address.** The sender's name is the app's (`site_name`) in the email's language. Most
  mailboxes only send as their own address, or an alias verified with them: anything else is refused or lands in spam.
- **Development** sends to Mailpit (`compose.dev.yaml`, started by `pnpm services`). It accepts every email without a
  login and delivers none: read them at http://localhost:8025.

### Providers

- **Gmail:** turn on 2-Step Verification for the account, then create an app password (Google Account → Security →
  2-Step Verification → App passwords). Use it as `SMTP_PASSWORD` without its spaces, never the account's own
  password. A Google Workspace admin can turn app passwords off; the account then needs OAuth2, which this code
  doesn't do.
- **Yahoo:** `smtp.mail.yahoo.com`, an app password from the account's security settings, the same way.
- **The domain host's mailbox** (cPanel, DirectAdmin and similar): the host's SMTP server and the mailbox's own login.
  The email comes from the project's domain, and the host usually publishes its SPF and DKIM records already, so it
  is the most likely of these to reach the inbox.
- **Outlook, Hotmail and Microsoft 365** no longer accept a password over SMTP and need OAuth2: not supported here.

### Limits

A regular mailbox is made for a person, not an app:

- **Daily caps.** About 500 recipients a day on free Gmail, about 2,000 on Workspace; other providers are similar or
  lower. Sign-up and reset emails for a small or medium app fit; newsletters and bulk notifications don't.
- **Suspicious bursts lock accounts.** `mail.send` sends one email at a time per app process, which keeps the rate
  down, but a sudden flood of sign-ups can still look like spam to the provider.
- **Hosts that block SMTP.** Some VPS providers block outgoing ports 25 and 465 on new servers. Use 587, or ask the
  host to open the port.
- **Spam folders.** The checks a receiving server makes (SPF, DKIM, DMARC) pass for the provider's own address, so a
  Gmail address sending as itself is fine. Volume and complaints are what send it to spam. The emails say so: the
  "check your email" notice tells the reader to look in spam too.

## Sending an Email

Every email goes through `mail.send` (`SendMail` in `src/mail/jobs.server.ts`), never straight from a request:

- **The request doesn't wait on the mailbox.** Queueing is one insert; SMTP takes a second or more.
- **A mailbox that's down is tried again.** Retries wait 2 s, 4 s, … 256 s (`maxAttempts: 9`), so an outage of up to
  eight minutes still delivers the email while its link works. A silent server is given up on after 15 seconds to
  connect or greet and 30 seconds of silence, so a run never holds the one worker for long.
- **A refusal for good isn't retried.** A 5xx reply (an unknown address, a rejected login, a daily limit reached) is
  a `MailDeliveryError` with `permanent: true`: the job logs it as an error once, which reports it to the error viewer
  with the server's reply, and ends. A 4xx reply, a timeout or a dropped connection fails the run, and it is retried.
- **No addresses in the logs.** The line for a sent email (`email sent`) has the template and the message ID. A
  failure is a `MailDeliveryError`, the server's reply with every address in it masked.
- **Not exactly once.** A run cut off after the server accepted the email, but before the queue heard back, runs
  again and the email arrives twice. Every email must be safe to receive twice.
- **The payload holds the link,** token included, so the job row is as secret as the link. The queue deletes finished
  rows after three days and failed ones after 30 ([jobs.md](./jobs.md) → When a Job Fails); a link's own expiry is
  shorter.

Queue one from a service with `SendMail.enqueue`, inside the transaction it follows from, so the email is queued only
if that transaction commits ([jobs.md](./jobs.md) → Queueing a Job). The service yields `Jobs` when its layer is built
and provides it to the call:

<!-- prettier-ignore -->
```ts
yield* SendMail.enqueue({ template: "verify-email", to: user.email, name: user.name, url, locale }).pipe(
  Effect.provideService(Jobs, jobs),
);
```

Better-Auth's callbacks run outside Effect, so the `Auth` layer (`src/server/auth.server.ts`) gives
`createBetterAuth` a `queueMail` function that runs `SendMail.enqueue` with the layer's `Jobs`. The auth emails don't
wait for it either (`sendAuthMail`): Better-Auth answers a request for an unknown address without sending anything, so
a request that waited on the queue would take measurably longer for an address that has an account.

The locale is the recipient's, not the process's: a job has no request. Better-Auth's emails take it from the
`x-locale` header the auth client sends (`requestLocale` in `src/server/better-auth.server.ts`). An email that isn't a
reply to the reader's own request (a notification) needs the reader's language stored with them.

## Adding an Email

1. **Template:** `src/mail/templates/<name>.tsx`, a component built on `MailLayout` that takes `MailProps` (`locale`,
   `name`, `url`), and its subject function. Copy `reset-password.tsx`.
2. **Messages:** the subject, preview line, heading, body and button label, `mail_<name>_*` keys in every file of
   `messages/`. Call each with `{ locale }` as its second argument: `m.mail_x({}, { locale })`. The template never
   reads `getLocale()`, which in a job is the base locale.
3. **Register it** in `TEMPLATES` (`src/mail/render.server.tsx`); the payload schema's `template` accepts the names
   there. The name is part of queued payloads: keep a name as long as jobs that use it may be queued, and add a new one
   rather than changing what an old one means.
4. **Queue it** where the email follows from something (a service, an auth hook) with `SendMail.enqueue`.

A template that needs more than a name and a link (an order's lines, a date) widens `MailProps` with its own fields,
and `MailPayload` in `src/mail/jobs.server.ts` too.

### Writing a Template

Email clients are not browsers, so templates follow their own rules, not the app's UI rules:

- **Inline styles and hex colours.** Many clients strip `<style>` and ignore classes, and none read CSS variables or
  `oklch()`. Colours come from `mailTheme` (`templates/theme.ts`), the light theme's tokens converted to hex: keep them
  in step with `src/styles.css`. The lint rules against inline styles and raw colours are off for
  `src/mail/templates/` only (`.oxlintrc.json`).
- **Direction on `Html` and `Body`.** React Email's `Body` sets `dir="ltr" lang="en"` itself, which would win over
  `Html`'s. `MailLayout` sets both from the locale.
- **Fonts fall back.** Gmail and most webmail ignore web fonts; `mailFontFamily` falls back to Tahoma and system fonts,
  which carry Persian.
- **One call to action,** with its address written out under it in `dir="ltr"`, for clients that break buttons.
- **A plain-text part** is made from the HTML (`renderMail`), so the two never disagree.

To look at one, render it to a file: the HTML that `renderMail` returns opens in any browser. Or send it in
development and open it in Mailpit, which also shows the plain-text part and the raw source.

## Testing

`src/mail/jobs.server.test.ts` runs `SendMail.run` against a mailbox in memory (`Mailer.layerMemory`): the email is
rendered in its language with its link, a refusal for good ends the run, and a temporary one fails it so the queue
retries. The browser tests read real emails from Mailpit's API (`e2e/mailbox.ts`): sign-up opens its confirmation
link (`signUpAndConfirm` in `e2e/accounts.ts`), and `e2e/password-reset.spec.ts` goes through a reset. CI runs
Mailpit with the other services (`pnpm services`).
