import { MailCheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "#/components/primitive/alert/alert";
import { m } from "#/paraglide/messages";

/*===== Check Inbox =====*/
/**
 * Says an email is on its way: after sign-up, and after asking for a password reset. `children` say what it holds;
 * the spam hint is always last, since a regular mailbox's email lands there more often than a mail service's.
 * The success alert is a `status`, so it's announced once it replaces the form.
 */
export function CheckInbox({ children }: { children: ReactNode }) {
  return (
    <Alert variant="success">
      <MailCheckIcon />
      <AlertTitle>{m.auth_check_inbox_title()}</AlertTitle>
      <AlertDescription>
        {children}
        <p>{m.auth_check_inbox_spam()}</p>
      </AlertDescription>
    </Alert>
  );
}

/** The address an email went to, set left to right in either language, as addresses always are. */
export function SentToAddress({ email }: { email: string }) {
  return (
    <p>
      {m.auth_check_inbox_sent_to()}{" "}
      <bdi dir="ltr" className="font-medium">
        {email}
      </bdi>
    </p>
  );
}
