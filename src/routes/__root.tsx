import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { Provider as JotaiProvider } from "jotai";

import { Button } from "#/components/primitive/button/button";
import { buttonVariants } from "#/components/primitive/button/button.styles";
import { DirectionProvider } from "#/components/primitive/direction/direction";
import { Toaster } from "#/components/primitive/toast/toast";
import { TooltipProvider } from "#/components/primitive/tooltip/tooltip";
import { PageMessage } from "#/components/shared/page-message/page-message";
import { THEME_INIT_SCRIPT } from "#/lib/theme";
import { orpc } from "#/orpc/client";
import { m } from "#/paraglide/messages";
import { getLocale, getTextDirection, localizeHref } from "#/paraglide/runtime";
import type { RouterContext } from "#/router";
import appCss from "#/styles.css?url";

/*===== Route =====*/
export const Route = createRootRouteWithContext<RouterContext>()({
  // The public origin, for the absolute URLs in every page's head tags (`absoluteUrl` in `src/lib/seo.ts`). It never
  // changes while the app runs, so client navigations don't fetch it again.
  loader: ({ context }) => context.queryClient.ensureQueryData(orpc.site.origin.queryOptions({ staleTime: Infinity })),
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
  // The URL decides the locale, on the server and in the browser alike (docs/frontend/i18n.md), and the locale decides
  // the direction: Persian is right-to-left, English left-to-right.
  const locale = getLocale();
  const direction = getTextDirection(locale);

  return (
    // The theme script changes <html>'s class and style before hydration, so React must not
    // treat that as a mismatch.
    <html lang={locale} dir={direction} suppressHydrationWarning>
      <head>
        {/* First in <head>: applies the saved or system theme before anything paints. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {/*===== Global Providers =====*/}
        {/* Base UI reads direction from context, not the `dir` attribute, so popups, sliders, and
            menus need the provider to position and navigate correctly in either direction. */}
        {/* Without a Provider, Jotai uses a module-level default store that the server would
            share across requests, so each render tree gets its own store instead. */}
        {/* `QueryClientProvider` comes from the router (`setupRouterSsrQueryIntegration` in `src/router.tsx`). */}
        <JotaiProvider>
          <DirectionProvider direction={direction}>
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
// The app's last error screens: what shows when something breaks above the site's layout (its `beforeLoad`, the root
// itself), so they render without the header and footer and bring their own `<main>` and ways out. Their links are
// plain anchors, a full page load: a client navigation would keep the layout or root that failed.

function RootError({ error }: ErrorComponentProps) {
  return (
    <main>
      <PageMessage title={m.root_error_title()} details={m.root_error_details()}>
        <Button size="lg" onClick={() => window.location.reload()}>
          {m.root_error_retry()}
        </Button>
        <a href={localizeHref("/")} className={buttonVariants({ variant: "outline", size: "lg" })}>
          {m.root_go_home()}
        </a>
      </PageMessage>
      {/* Development only: production errors can carry internals the visitor shouldn't see. */}
      {import.meta.env.DEV && error instanceof Error && (
        <pre dir="ltr" className="mx-auto max-w-site overflow-x-auto px-4 pb-20 text-start text-caption sm:px-6">
          <code>{error.stack ?? error.message}</code>
        </pre>
      )}
    </main>
  );
}

/** A 404 from a route with no `notFoundComponent` of its own; pages in the site's layout use `NotFoundPage`. */
function NotFound() {
  return (
    <main>
      <PageMessage title={m.root_not_found_title()} details={m.root_not_found_details()}>
        <a href={localizeHref("/")} className={buttonVariants({ size: "lg" })}>
          {m.root_go_home()}
        </a>
      </PageMessage>
    </main>
  );
}
