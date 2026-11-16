import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { buttonVariants } from "#/components/primitive/button/button.styles";
import { AuthCard } from "#/components/shared/auth-card/auth-card";
import { CheckInbox, SentToAddress } from "#/components/shared/check-inbox/check-inbox";
import { pageMeta } from "#/lib/seo";
import { m } from "#/paraglide/messages";
import { ForgotPasswordForm } from "#/routes/forgot_password/components/forgot-password-form";

/*===== Route =====*/
export const Route = createFileRoute("/_site-layout/forgot-password")({
  head: (args) => pageMeta({ args, title: m.forgot_title(), index: false }),
  component: ForgotPasswordPage,
});

/*===== Page =====*/
/** Sends a link to choose a new password. Open to everyone: a signed-in person may have forgotten theirs too. */
function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string>();

  return (
    <AuthCard title={m.forgot_heading()}>
      <div className="flex flex-col gap-6">
        {sentTo ? (
          <CheckInbox>
            <SentToAddress email={sentTo} />
            <p>{m.forgot_sent()}</p>
          </CheckInbox>
        ) : (
          <>
            <p className="text-body text-muted-foreground">{m.forgot_intro()}</p>
            <ForgotPasswordForm onSent={setSentTo} />
          </>
        )}
        <Link to="/auth" className={buttonVariants({ variant: "link", size: "sm" })}>
          {m.auth_back_to_sign_in()}
        </Link>
      </div>
    </AuthCard>
  );
}
