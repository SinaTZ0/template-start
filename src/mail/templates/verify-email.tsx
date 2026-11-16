import { MailLayout, MailText } from "#/mail/templates/layout";
import type { MailProps } from "#/mail/templates/types";
import { m } from "#/paraglide/messages";
import type { Locale } from "#/paraglide/runtime";

/*===== Verify Email =====*/
/** Sent on sign-up, and again on a sign-in before the address is confirmed. The link confirms it and signs in. */
export function VerifyEmail({ locale, name, url, hours }: MailProps & { hours: number }) {
  return (
    <MailLayout
      locale={locale}
      preview={m.mail_verify_preview({}, { locale })}
      heading={m.mail_verify_heading({}, { locale })}
      action={{ label: m.mail_verify_action({}, { locale }), url }}
    >
      <MailText>{m.mail_greeting({ name }, { locale })}</MailText>
      <MailText>{m.mail_verify_body({ site: m.site_name({}, { locale }) }, { locale })}</MailText>
      <MailText muted>{m.mail_link_expires({ hours }, { locale })}</MailText>
      <MailText muted>{m.mail_verify_ignore({}, { locale })}</MailText>
    </MailLayout>
  );
}

export const verifyEmailSubject = (locale: Locale) => m.mail_verify_subject({}, { locale });
