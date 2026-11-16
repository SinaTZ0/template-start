import { expect } from "@playwright/test";

/*===== Mailbox =====*/
// The emails the app sent, read from Mailpit (`compose.dev.yaml`), which keeps every one and delivers none. The app sends
// through a queued job (docs/backend/mail.md), so an email shows up a moment after the request that caused it.

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

type MailpitSearch = { messages: { ID: string; Subject: string }[] };
type MailpitMessage = { Subject: string; Text: string };

/**
 * The link in the newest email to `to` whose subject is `subject`, once it has arrived. The link is the first one in
 * the plain-text part that leads into the app's auth endpoints or pages, which is where every auth email points.
 */
export async function linkFromEmail({ to, subject }: { to: string; subject: string }): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await fetchJson<MailpitSearch>(`/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const found = search.messages.find((message) => message.Subject === subject);
        if (!found) return undefined;
        const message = await fetchJson<MailpitMessage>(`/api/v1/message/${found.ID}`);
        link = message.Text.match(/https?:\/\/\S+/)?.[0];
        return link;
      },
      { message: `an email "${subject}" to ${to}`, timeout: 20_000 },
    )
    .toBeTruthy();
  return link!;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT_URL}${path}`);
  if (!response.ok) throw new Error(`Mailpit answered ${response.status} for ${path}. Is it running (pnpm services)?`);
  return (await response.json()) as T;
}
