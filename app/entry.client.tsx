import * as Sentry from "@sentry/browser";
import { startTransition, StrictMode } from "react";
import type { ErrorInfo } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

/*===== Error Reporting =====*/
// Browser errors go to the same tracker as the server's (docs/backend/logging.md). The DSN is baked in at build time
// (`envPrefix` in `vite.config.ts`); without it nothing is sent. It is public by design: it only allows sending events.
if (import.meta.env.SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Query strings can carry tokens; cookies and headers carry the session.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false },
  });
}

/**
 * Reports a render error that a route's `ErrorBoundary` caught. Uncaught errors reach Sentry's global handlers on their
 * own; caught ones don't. Server errors shown in a boundary aren't React errors and don't pass through here, so they
 * are reported once, by the server.
 */
function onCaughtError(error: unknown, errorInfo: ErrorInfo) {
  // Replaces React's default, which logs to the console.
  console.error(error);
  Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } });
}

/*===== Hydration =====*/
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
    { onCaughtError },
  );
});
