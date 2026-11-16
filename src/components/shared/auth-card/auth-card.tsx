import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "#/components/primitive/card/card";

/*===== Auth Card =====*/
/**
 * The narrow card the account pages are set in: sign-in and sign-up, forgot password, reset password and the email
 * confirmation. `title` is the page's one `h1`.
 */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-h2">{title}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
