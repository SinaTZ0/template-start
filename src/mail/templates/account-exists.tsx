import { MailLayout, MailText } from "#/mail/templates/layout";
import type { MailProps } from "#/mail/templates/types";
import { m } from "#/paraglide/messages";
import type { Locale } from "#/paraglide/runtime";

/*===== Account Exists =====*/
/**
 * Sent when someone signs up with an address that already has an account. Sign-up answers the same either way, so it
 * can't be used to find out who has an account; this email is how the owner learns what happened. The link opens the
 * page that sends a password reset, for an owner who signed up again because they forgot theirs.
 */
export function AccountExists({ locale, name, url }: MailProps) {
  return (
    <MailLayout
      locale={locale}
      preview={m.mail_exists_preview({}, { locale })}
      heading={m.mail_exists_heading({}, { locale })}
      action={{ label: m.mail_exists_action({}, { locale }), url }}
    >
      <MailText>{m.mail_greeting({ name }, { locale })}</MailText>
      <MailText>{m.mail_exists_body({ site: m.site_name({}, { locale }) }, { locale })}</MailText>
      <MailText muted>{m.mail_exists_ignore({}, { locale })}</MailText>
    </MailLayout>
  );
}

export const accountExistsSubject = (locale: Locale) => m.mail_exists_subject({}, { locale });
