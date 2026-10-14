import { redirect, useNavigate, useRevalidator } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/primitive/card/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/primitive/tabs/tabs";
import { auth } from "~/lib/auth.server";
import { pageTitle } from "~/lib/site";
import { SignInForm } from "~/routes/auth/components/sign-in-form";
import { SignUpForm } from "~/routes/auth/components/sign-up-form";

import type { Route } from "./+types/auth";

/** Where people land after signing in when nothing asked for a page. */
const DEFAULT_REDIRECT = "/notes";

/*===== Meta =====*/
export const meta: Route.MetaFunction = () => [{ title: pageTitle("ورود") }];

/*===== Loader =====*/
export async function loader({ request }: Route.LoaderArgs) {
  const redirectTo = safeRedirect(new URL(request.url).searchParams.get("redirectTo"));
  const session = await auth.api.getSession({ headers: request.headers });

  // Signed-in people have nothing to do here.
  if (session) throw redirect(redirectTo);

  return { redirectTo };
}

/** Only same-site paths, so a crafted `?redirectTo=` link can't send someone to another site after signing in. */
function safeRedirect(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : DEFAULT_REDIRECT;
}

/*===== Page =====*/
export default function AuthPage({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  // A plain navigation keeps the mounted layout's loader data, so revalidate for the header to pick up the session.
  const goOn = async () => {
    await navigate(loaderData.redirectTo, { replace: true });
    await revalidator.revalidate();
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
