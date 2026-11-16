import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "#/components/primitive/alert/alert";
import { buttonVariants } from "#/components/primitive/button/button.styles";
import { AuthCard } from "#/components/shared/auth-card/auth-card";
import { pageMeta } from "#/lib/seo";
import { m } from "#/paraglide/messages";
import { ResetPasswordForm } from "#/routes/reset_password/components/reset-password-form";
import { resetPasswordSearchSchema } from "#/routes/reset_password/schema";

/*===== Route =====*/
export const Route = createFileRoute("/_site-layout/reset-password")({
  validateSearch: resetPasswordSearchSchema,
  head: (args) => pageMeta({ args, title: m.reset_title(), index: false }),
  component: ResetPasswordPage,
});

/*===== Page =====*/
type ResetState = "form" | "done" | "invalid";

/** Where a password reset email's link lands: a form for the new password, or a way to ask for a new link. */
function ResetPasswordPage() {
  const { token, error } = Route.useSearch();
  const [state, setState] = useState<ResetState>(token && !error ? "form" : "invalid");

  return (
    <AuthCard title={m.reset_heading()}>
      {/*===== New Password =====*/}
      {state === "form" && token && (
        <ResetPasswordForm token={token} onDone={() => setState("done")} onInvalid={() => setState("invalid")} />
      )}

      {/*===== Saved =====*/}
      {state === "done" && (
        <div className="flex flex-col gap-6">
          <Alert variant="success">
            <CircleCheckIcon />
            <AlertTitle>{m.reset_done_title()}</AlertTitle>
            <AlertDescription>{m.reset_done_body()}</AlertDescription>
          </Alert>
          <Link to="/auth" className={buttonVariants()}>
            {m.auth_go_sign_in()}
          </Link>
        </div>
      )}

      {/*===== Used or Expired Link =====*/}
      {state === "invalid" && (
        <div className="flex flex-col gap-6">
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>{m.reset_invalid_title()}</AlertTitle>
            <AlertDescription>{m.reset_invalid_body()}</AlertDescription>
          </Alert>
          <Link to="/forgot-password" className={buttonVariants()}>
            {m.reset_request_new()}
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
