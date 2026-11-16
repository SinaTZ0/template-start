import type { ReactNode } from "react";
import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "react-email";

import { mailFontFamily, mailTheme } from "#/mail/templates/theme";
import { m } from "#/paraglide/messages";
import { getTextDirection, type Locale } from "#/paraglide/runtime";

/*===== Mail Layout =====*/
// The frame every email shares: the site's name, a heading, the body, one call to action and the footer. The text is
// set in the email's own locale (passed in, never the process's), and the direction follows it, so a Persian email
// reads right to left in every client.

type MailLayoutProps = {
  locale: Locale;
  /** The line inbox lists show after the subject. */
  preview: string;
  heading: string;
  children: ReactNode;
  action: { label: string; url: string };
};

export function MailLayout({ locale, preview, heading, children, action }: MailLayoutProps) {
  const dir = getTextDirection(locale);
  const textAlign = dir === "rtl" ? "right" : "left";

  return (
    <Html lang={locale} dir={dir}>
      <Head />
      <Preview>{preview}</Preview>
      {/* `Body` sets `dir="ltr" lang="en"` itself unless told otherwise, which would win over `Html`'s. */}
      <Body
        dir={dir}
        lang={locale}
        style={{ backgroundColor: mailTheme.page, fontFamily: mailFontFamily, margin: 0, padding: "24px 0" }}
      >
        <Container
          style={{
            backgroundColor: mailTheme.background,
            border: `1px solid ${mailTheme.border}`,
            borderRadius: mailTheme.radius,
            maxWidth: "560px",
            padding: "32px",
            textAlign,
          }}
        >
          {/*===== Header =====*/}
          <Text style={{ color: mailTheme.primary, fontSize: "14px", fontWeight: 700, margin: "0 0 24px" }}>
            {m.site_name({}, { locale })}
          </Text>
          <Heading
            as="h1"
            style={{ color: mailTheme.foreground, fontSize: "22px", lineHeight: "1.6", margin: "0 0 16px" }}
          >
            {heading}
          </Heading>

          {/*===== Body =====*/}
          {children}

          {/*===== Action =====*/}
          <Section style={{ margin: "28px 0" }}>
            <Button
              href={action.url}
              style={{
                backgroundColor: mailTheme.primary,
                borderRadius: mailTheme.radius,
                color: mailTheme.primaryForeground,
                fontSize: "15px",
                fontWeight: 700,
                padding: "12px 24px",
              }}
            >
              {action.label}
            </Button>
          </Section>
          {/* Some clients block buttons or break their links, so the address is also written out. Always LTR: a URL
              set right to left shows its parts in the wrong order. */}
          <MailText muted>{m.mail_link_fallback({}, { locale })}</MailText>
          <Text dir="ltr" style={{ fontSize: "13px", lineHeight: "1.6", margin: "0 0 8px", textAlign: "left" }}>
            <Link href={action.url} style={{ color: mailTheme.primary, wordBreak: "break-all" }}>
              {action.url}
            </Link>
          </Text>

          {/*===== Footer =====*/}
          <Hr style={{ borderColor: mailTheme.border, margin: "24px 0" }} />
          <MailText muted>{m.mail_footer({ site: m.site_name({}, { locale }) }, { locale })}</MailText>
        </Container>
      </Body>
    </Html>
  );
}

/*===== Text =====*/
/** A paragraph in the email's type: generous line height, which Persian needs. `muted` for notes and the footer. */
export function MailText({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <Text
      style={{
        color: muted ? mailTheme.mutedForeground : mailTheme.foreground,
        fontSize: muted ? "13px" : "15px",
        lineHeight: "1.9",
        margin: "0 0 12px",
      }}
    >
      {children}
    </Text>
  );
}
