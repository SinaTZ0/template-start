import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { Card, CardContent, CardHeader, CardTitle } from "#/components/primitive/card/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/primitive/tabs/tabs";
import { localizedPath } from "#/lib/locale";
import { redirectToParam } from "#/lib/search-params";
import { pageMeta } from "#/lib/seo";
import { roleHomePath } from "#/lib/viewer";
import { orpc } from "#/orpc/client";
import { m } from "#/paraglide/messages";
import { SignInForm } from "#/routes/auth/components/sign-in-form";
import { SignUpForm } from "#/routes/auth/components/sign-up-form";

const searchSchema = z.object({
  redirectTo: redirectToParam,
});

/*===== Route =====*/
export const Route = createFileRoute("/_site-layout/auth")({
  validateSearch: searchSchema,
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
function AuthPage() {
  const redirectTo = Route.useSearch({ select: (search) => search.redirectTo });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // The cached viewer still says "signed out": refetch it first, so the header updates and the next page's guard sees
  // the session. With no page asked for, the fresh viewer's role picks where to land.
  const goOn = async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.session.viewer.key() });
    const viewer = await queryClient.fetchQuery(orpc.session.viewer.queryOptions());
    await navigate({ href: redirectTo ?? roleHomePath(viewer?.role), replace: true });
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-h2">{m.auth_heading()}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="sign-in">
            <TabsList className="mb-6 w-full">
              <TabsTrigger value="sign-in">{m.auth_tab_sign_in()}</TabsTrigger>
              <TabsTrigger value="sign-up">{m.auth_tab_sign_up()}</TabsTrigger>
            </TabsList>
            <TabsContent value="sign-in">
              <SignInForm onSuccess={() => void goOn()} />
            </TabsContent>
            <TabsContent value="sign-up">
              <SignUpForm onSuccess={() => void goOn()} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
