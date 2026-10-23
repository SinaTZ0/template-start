import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createServerFn } from "@tanstack/react-start";
import { Provider as JotaiProvider } from "jotai";

import { DirectionProvider } from "#/components/primitive/direction/direction";
import { Toaster } from "#/components/primitive/toast/toast";
import { TooltipProvider } from "#/components/primitive/tooltip/tooltip";
import { SITE_ORIGIN } from "#/lib/site.server";
import { THEME_INIT_SCRIPT } from "#/lib/theme";
import type { RouterContext } from "#/router";
import appCss from "#/styles.css?url";

/*===== Site Origin =====*/
/** The public origin, for the absolute URLs in every page's head tags (`absoluteUrl` in `src/lib/seo.ts`). */
const getSiteOrigin = createServerFn({ method: "GET" }).handler(() => ({ origin: SITE_ORIGIN }));

/*===== Route =====*/
export const Route = createRootRouteWithContext<RouterContext>()({
  loader: () => getSiteOrigin(),
  // The origin never changes while the app runs, so client navigations don't fetch it again.
  staleTime: Infinity,
  head: () => ({
    meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});

/*===== Document =====*/
function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // The theme script changes <html>'s class and style before hydration, so React must not
    // treat that as a mismatch.
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        {/* First in <head>: applies the saved or system theme before anything paints. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {/*===== Global Providers =====*/}
        {/* Base UI reads direction from context, not the `dir` attribute, so popups, sliders, and
            menus need the provider to position and navigate correctly in RTL. */}
        {/* Without a Provider, Jotai uses a module-level default store that the server would
            share across requests, so each render tree gets its own store instead. */}
        {/* `QueryClientProvider` comes from the router (`setupRouterSsrQueryIntegration` in `src/router.tsx`). */}
        <JotaiProvider>
          <DirectionProvider direction="rtl">
            <TooltipProvider>
              {children}
              <Toaster />
            </TooltipProvider>
          </DirectionProvider>
        </JotaiProvider>
        {/*===== Devtools =====*/}
        {/* Development only: the devtools Vite plugin (`vite.config.ts`) removes this from production builds. */}
        <TanStackDevtools
          config={{ position: "bottom-right" }}
          plugins={[{ name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> }]}
        />
        <Scripts />
      </body>
    </html>
  );
}

/*===== Errors =====*/
function ErrorMessage({ message, details, stack }: { message: string; details: string; stack?: string }) {
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

function RootError({ error }: ErrorComponentProps) {
  // Details only in development: production errors can carry internals the visitor shouldn't see.
  if (import.meta.env.DEV && error instanceof Error) {
    return <ErrorMessage message="Error" details={error.message} stack={error.stack} />;
  }
  return <ErrorMessage message="Oops!" details="An unexpected error occurred." />;
}

function NotFound() {
  return <ErrorMessage message="404" details="The requested page could not be found." />;
}
