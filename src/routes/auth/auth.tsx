import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Schema } from "effect";

import { Button } from "#/components/primitive/button/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/primitive/tabs/tabs";
import { AuthCard } from "#/components/shared/auth-card/auth-card";
import { CheckInbox, SentToAddress } from "#/components/shared/check-inbox/check-inbox";
import { localizedPath } from "#/lib/locale";
import { searchSchema } from "#/lib/schema";
import { redirectToParam } from "#/lib/search-params";
import { pageMeta } from "#/lib/seo";
import { roleHomePath } from "#/lib/viewer";
import { orpc } from "#/orpc/client";
import { m } from "#/paraglide/messages";
import { SignInForm } from "#/routes/auth/components/sign-in-form";
import { SignUpForm } from "#/routes/auth/components/sign-up-form";

const authSearchSchema = searchSchema(Schema.Struct({ redirectTo: redirectToParam }));

/*===== Route =====*/
export const Route = createFileRoute("/_site-layout/auth")({
  validateSearch: authSearchSchema,
  beforeLoad: async ({ context, search }) => {
    // Signed-in people have nothing to do here.
    const viewer = await context.queryClient.ensureQueryData(orpc.session.viewer.queryOptions());
    // `href` skips the router's locale prefix, so it's added here (`localizedPath`).
    if (viewer) throw redirect({ href: localizedPath(search.redirectTo ?? roleHomePath(viewer.role)) });
  },
  // Sign-in has nothing to find in search results. After `beforeLoad`, whose result `args` carries
  // (docs/frontend/seo.md).
  head: (args) => pageMeta({ args, title: m.auth_title(), index: false }),
  component: AuthPage,
});

/*===== Page =====*/
type AuthTab = "sign-in" | "sign-up";

function AuthPage() {
  const redirectTo = Route.useSearch({ select: (search) => search.redirectTo });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<AuthTab>("sign-in");
  // The address a new account's confirmation link went to. Sign-up doesn't sign in: the link in that email does.
  const [sentTo, setSentTo] = useState<string>();

  // The cached viewer still says "signed out": refetch it first, so the header updates and the next page's guard sees
  // the session. With no page asked for, the fresh viewer's role picks where to land.
  const goOn = async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.session.viewer.key() });
    const viewer = await queryClient.fetchQuery(orpc.session.viewer.queryOptions());
    await navigate({ href: redirectTo ?? roleHomePath(viewer?.role), replace: true });
  };

  /*------ Signed Up ------*/
  if (sentTo) {
    return (
      <AuthCard title={m.auth_heading()}>
        <div className="flex flex-col gap-6">
          <CheckInbox>
            <SentToAddress email={sentTo} />
            <p>{m.auth_check_inbox_next()}</p>
          </CheckInbox>
          <Button
            variant="outline"
            onClick={() => {
              setSentTo(undefined);
              setTab("sign-in");
            }}
          >
            {m.auth_back_to_sign_in()}
          </Button>
        </div>
      </AuthCard>
    );
  }

  /*------ Forms ------*/
  return (
    <AuthCard title={m.auth_heading()}>
      <Tabs value={tab} onValueChange={(value: AuthTab) => setTab(value)}>
        <TabsList className="mb-6 w-full">
          <TabsTrigger value="sign-in">{m.auth_tab_sign_in()}</TabsTrigger>
          <TabsTrigger value="sign-up">{m.auth_tab_sign_up()}</TabsTrigger>
        </TabsList>
        <TabsContent value="sign-in">
          <SignInForm onSuccess={() => void goOn()} />
        </TabsContent>
        <TabsContent value="sign-up">
          <SignUpForm onSuccess={setSentTo} />
        </TabsContent>
      </Tabs>
    </AuthCard>
  );
}
