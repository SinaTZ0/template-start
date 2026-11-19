import { createServerEntry, createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

import { Cause, Effect, Exit } from "effect";

import { jobs } from "#/jobs.server";
import { defineLocaleHeaderStrategy } from "#/lib/locale.server";
import { deLocalizeHref } from "#/paraglide/runtime";
import { paraglideMiddleware } from "#/paraglide/server";
import { runJobWorkers } from "#/server/jobs.server";
import { observeRequest } from "#/server/observability/http.server";
import { appRuntime } from "#/server/runtime.server";
import type { AppServices } from "#/server/runtime.server";

import { getRouter } from "./router";

/*===== Background Jobs =====*/
// The server entry is loaded once when the server starts, which makes it the place to start the workers that run the
// queued and scheduled jobs in this process (docs/backend/jobs.md). They live as long as the runtime: a reload in
// development disposes it, which stops them.
// Starting them builds the runtime, so a configuration the server can't run with (a missing variable, a short secret)
// stops the server here, at startup, with the reason.
appRuntime
  .runFork(Effect.scoped(Effect.andThen(runJobWorkers<AppServices>(jobs), Effect.never)))
  .addObserver((exit) => {
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
      process.stderr.write(`The server can't start: ${Cause.pretty(exit.cause)}\n`);
      process.exit(1);
    }
  });

/*===== Locale =====*/
// The strategy `/rpc` requests resolve their locale with (`project.inlang/paraglide.config.ts`).
defineLocaleHeaderStrategy();

/*===== Route Patterns =====*/
// A router kept only to match paths: it never loads or renders anything.
const routeMatcher = getRouter();

/**
 * The route pattern a path matched (`/notes/$id`), so the request log and slow-request reports group a route's
 * requests together, in every locale (`/en/notes/…` too). Paths no route matches (assets, 404s)
 * are returned as they are.
 */
function routePattern(path: string): string {
  const [, , foundRoute] = routeMatcher.getMatchedRoutes(deLocalizeHref(path));
  return foundRoute?.fullPath ?? path;
}

/*===== Request Handling =====*/
const handleRequest = createStartHandler(defaultStreamHandler);

/**
 * Start's handler, wrapped so every request (pages, `/rpc/*`, `/api/auth/*`, 404s) runs inside its own trace, with
 * one log line and an `X-Request-Id` (`observeRequest`, docs/backend/logging.md).
 *
 * Inside it, `paraglideMiddleware` resolves the request's locale and keeps it for everything the request runs, so
 * `getLocale()` and every message follow it (docs/frontend/i18n.md). Start gets the request as it came, prefix
 * included: the router's `rewrite` (`src/router.tsx`) removes it, so the server's router sees the same URL as the
 * browser's.
 */
export default createServerEntry({
  fetch(request, opts) {
    const route = routePattern(new URL(request.url).pathname);
    return appRuntime
      .runPromise(
        observeRequest({
          request,
          route,
          handle: () => paraglideMiddleware(request, () => handleRequest(request, opts)),
        }),
      )
      .catch((error: unknown) => {
        // Only when the runtime itself is broken: every failure inside a request is answered by `observeRequest`.
        process.stderr.write(`request handling failed: ${String(error)}\n`);
        return new Response("Internal Server Error", { status: 500 });
      });
  },
});
