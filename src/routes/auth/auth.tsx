import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { Card, CardContent, CardHeader, CardTitle } from "#/components/primitive/card/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/primitive/tabs/tabs";
import { redirectToParam } from "#/lib/search-params";
import { pageMeta } from "#/lib/seo";
import { viewerQueryOptions } from "#/lib/viewer";
import { SignInForm } from "#/routes/auth/components/sign-in-form";
import { SignUpForm } from "#/routes/auth/components/sign-up-form";

/** Where people land after signing in when nothing asked for a page. */
const DEFAULT_REDIRECT = "/notes";

const searchSchema = z.object({
  redirectTo: redirectToParam,
});

/*===== Route =====*/
export const Route = createFileRoute("/_site-layout/auth")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, search }) => {
    // Signed-in people have nothing to do here.
    const viewer = await context.queryClient.ensureQueryData(viewerQueryOptions);
    if (viewer) throw redirect({ href: search.redirectTo ?? DEFAULT_REDIRECT });
  },
  // Sign-in has nothing to find in search results. After `beforeLoad`, whose result `args` carries
  // (docs/frontend/seo.md).
  head: (args) => pageMeta({ args, title: "ورود", index: false }),
  component: AuthPage,
});

/*===== Page =====*/
function AuthPage() {
  const redirectTo = Route.useSearch({ select: (search) => search.redirectTo ?? DEFAULT_REDIRECT });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // The cached viewer still says "signed out": refetch it first, so the header updates and the next page's guard sees
  // the session.
  const goOn = async () => {
    await queryClient.invalidateQueries({ queryKey: viewerQueryOptions.queryKey });
    await navigate({ href: redirectTo, replace: true });
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-h2">ورود یا ثبت‌نام</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="sign-in">
            <TabsList className="mb-6 w-full">
              <TabsTrigger value="sign-in">ورود</TabsTrigger>
              <TabsTrigger value="sign-up">ثبت‌نام</TabsTrigger>
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
