import { render } from "@react-email/render";
import type { ReactElement } from "react";

import { RESET_PASSWORD_LINK_HOURS, VERIFY_EMAIL_LINK_HOURS } from "#/lib/auth-constants";
import { AccountExists, accountExistsSubject } from "#/mail/templates/account-exists";
import { ResetPassword, resetPasswordSubject } from "#/mail/templates/reset-password";
import type { MailProps } from "#/mail/templates/types";
import { VerifyEmail, verifyEmailSubject } from "#/mail/templates/verify-email";
import { m } from "#/paraglide/messages";
import type { Locale } from "#/paraglide/runtime";

/*===== Templates =====*/
// Every email the app sends, by the name a queued `mail.send` names it with. A name stays as long as jobs that use it
// may be queued: rename one by adding the new name and removing the old one a deploy later.
const TEMPLATES = {
  "verify-email": {
    subject: verifyEmailSubject,
    element: (props: MailProps) => <VerifyEmail {...props} hours={VERIFY_EMAIL_LINK_HOURS} />,
  },
  "reset-password": {
    subject: resetPasswordSubject,
    element: (props: MailProps) => <ResetPassword {...props} hours={RESET_PASSWORD_LINK_HOURS} />,
  },
  "account-exists": {
    subject: accountExistsSubject,
    element: (props: MailProps) => <AccountExists {...props} />,
  },
} satisfies Record<string, { subject: (locale: Locale) => string; element: (props: MailProps) => ReactElement }>;

export type MailTemplate = keyof typeof TEMPLATES;
export const MAIL_TEMPLATES = Object.keys(TEMPLATES) as [MailTemplate, ...MailTemplate[]];

/*===== Rendering =====*/
/**
 * An email ready to send: its subject, sender name, HTML and the plain-text part, all in `locale`. The plain text is
 * made from the HTML, so the two never say different things; clients that show text only, and spam filters that
 * compare the two, read it.
 */
export async function renderMail({ template, ...props }: MailProps & { template: MailTemplate }) {
  const { subject, element } = TEMPLATES[template];
  const email = element(props);
  const [html, text] = await Promise.all([render(email), render(email, { plainText: true })]);
  return { subject: subject(props.locale), fromName: m.site_name({}, { locale: props.locale }), html, text };
}
