import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import { NuqsAdapter } from "nuqs/adapters/react-router/v8";
import { useState } from "react";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { DirectionProvider } from "~/components/primitive/direction/direction";
import { Toaster } from "~/components/primitive/toast/toast";
import { TooltipProvider } from "~/components/primitive/tooltip/tooltip";
import { SITE_ORIGIN } from "~/lib/site.server";
import { THEME_INIT_SCRIPT } from "~/lib/theme";
import { currentTrace } from "~/lib/trace.server";

import type { Route } from "./+types/root";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  // One client per render tree (like the Jotai store): a module-level client on the server would
  // share cached data between users' requests.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Loader data seeds most queries, so don't refetch it the moment the page hydrates.
        defaultOptions: { queries: { staleTime: 30_000 } },
      }),
  );

  return (
    // The theme script changes <html>'s class and style before hydration, so React must not
    // treat that as a mismatch.
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        {/* First in <head>: applies the saved or system theme before anything paints. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {/*===== Global Providers =====*/}
        {/* Base UI reads direction from context, not the `dir` attribute, so popups, sliders, and
            menus need the provider to position and navigate correctly in RTL. */}
        {/* Without a Provider, Jotai uses a module-level default store that the server would
            share across requests, so each render tree gets its own store instead. */}
        {/* nuqs skips loaders by default (`shallow: true`). Most URL state here filters loader data, so
            updates revalidate unless a param opts into `shallow: true` for UI-only state. */}
        <NuqsAdapter defaultOptions={{ shallow: false }}>
          <QueryClientProvider client={queryClient}>
            <JotaiProvider>
              <DirectionProvider direction="rtl">
                <TooltipProvider>
                  {children}
                  <Toaster />
                </TooltipProvider>
              </DirectionProvider>
            </JotaiProvider>
          </QueryClientProvider>
        </NuqsAdapter>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/*===== Middleware =====*/
/**
 * Returns the request's `reqId` as `X-Request-Id`, so it shows in the browser's devtools and can be quoted in a bug
 * report. The root's middleware runs for every request the router handles: documents, `.data` requests and resource
 * routes, `/rpc/*` included. `next()` never throws (errors become the boundary's response), so failed requests get the
 * header too. A URL that matches no route runs no middleware; `entry.server.tsx` covers its 404.
 */
const requestIdMiddleware: Route.MiddlewareFunction = async (_, next) => {
  const response = await next();
  const id = currentTrace()?.id;
  if (id) response.headers.set("X-Request-Id", id);
  return response;
};

export const middleware: Route.MiddlewareFunction[] = [requestIdMiddleware];

/*===== Loader =====*/
/** The public origin, for the absolute URLs in every page's meta tags (`absoluteUrl` in `app/lib/seo.ts`). */
export function loader() {
  return { origin: SITE_ORIGIN };
}

// The origin never changes while the app runs, so client navigations and mutations don't need to fetch it again.
export const shouldRevalidate = () => false;

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details = error.status === 404 ? "The requested page could not be found." : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
