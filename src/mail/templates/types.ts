import type { Locale } from "#/paraglide/runtime";

/** What every email template is given: the language it's written in, the recipient's name and the link it leads to. */
export type MailProps = {
  locale: Locale;
  name: string;
  url: string;
};
