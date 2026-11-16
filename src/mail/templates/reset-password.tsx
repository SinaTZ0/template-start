import { MailLayout, MailText } from "#/mail/templates/layout";
import type { MailProps } from "#/mail/templates/types";
import { m } from "#/paraglide/messages";
import type { Locale } from "#/paraglide/runtime";

/*===== Reset Password =====*/
/** Sent when someone asks to reset an account's password. The link opens the page that sets a new one. */
export function ResetPassword({ locale, name, url, hours }: MailProps & { hours: number }) {
  return (
    <MailLayout
      locale={locale}
      preview={m.mail_reset_preview({}, { locale })}
      heading={m.mail_reset_heading({}, { locale })}
      action={{ label: m.mail_reset_action({}, { locale }), url }}
    >
      <MailText>{m.mail_greeting({ name }, { locale })}</MailText>
      <MailText>{m.mail_reset_body({ site: m.site_name({}, { locale }) }, { locale })}</MailText>
      <MailText muted>{m.mail_link_expires({ hours }, { locale })}</MailText>
      <MailText muted>{m.mail_reset_ignore({}, { locale })}</MailText>
    </MailLayout>
  );
}

export const resetPasswordSubject = (locale: Locale) => m.mail_reset_subject({}, { locale });
