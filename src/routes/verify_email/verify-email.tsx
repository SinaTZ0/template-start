import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { Schema } from "effect";

import { Alert, AlertDescription, AlertTitle } from "#/components/primitive/alert/alert";
import { buttonVariants } from "#/components/primitive/button/button.styles";
import { AuthCard } from "#/components/shared/auth-card/auth-card";
import { optionalSearchParam, searchSchema } from "#/lib/schema";
import { pageMeta } from "#/lib/seo";
import { roleHomePath } from "#/lib/viewer";
import { orpc } from "#/orpc/client";
import { m } from "#/paraglide/messages";

// Better-Auth's link check (`/api/auth/verify-email`) sends the browser here, signed in, or with `error=` naming why the
// link didn't work: expired, already used, or for an account other than the one signed in.
const verifyEmailSearchSchema = searchSchema(Schema.Struct({ error: optionalSearchParam(Schema.String) }));

/*===== Route =====*/
export const Route = createFileRoute("/_site-layout/verify-email")({
  validateSearch: verifyEmailSearchSchema,
  loader: ({ context }) => context.queryClient.ensureQueryData(orpc.session.viewer.queryOptions()),
  head: (args) => pageMeta({ args, title: m.verify_title(), index: false }),
  component: VerifyEmailPage,
});

/*===== Page =====*/
/** Where a confirmation email's link lands. */
function VerifyEmailPage() {
  const error = Route.useSearch({ select: (search) => search.error });
  const { data: viewer } = useSuspenseQuery(orpc.session.viewer.queryOptions());

  /*------ Link Didn't Work ------*/
  // Signing in sends a fresh link (`sendOnSignIn`), so that's the way on.
  if (error) {
    return (
      <AuthCard title={m.verify_title()}>
        <div className="flex flex-col gap-6">
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>{m.verify_invalid_title()}</AlertTitle>
            <AlertDescription>{m.verify_invalid_body()}</AlertDescription>
          </Alert>
          <Link to="/auth" className={buttonVariants()}>
            {m.auth_go_sign_in()}
          </Link>
        </div>
      </AuthCard>
    );
  }

  /*------ Confirmed ------*/
  // The link signs in (`autoSignInAfterVerification`). Without a session (cookies blocked), signing in is the way on.
  return (
    <AuthCard title={m.verify_title()}>
      <div className="flex flex-col gap-6">
        <Alert variant="success">
          <CircleCheckIcon />
          <AlertTitle>{m.verify_done_title()}</AlertTitle>
          <AlertDescription>{m.verify_done_body()}</AlertDescription>
        </Alert>
        {viewer ? (
          <Link to={roleHomePath(viewer.role)} className={buttonVariants()}>
            {m.verify_continue()}
          </Link>
        ) : (
          <Link to="/auth" className={buttonVariants()}>
            {m.auth_go_sign_in()}
          </Link>
        )}
      </div>
    </AuthCard>
  );
}
