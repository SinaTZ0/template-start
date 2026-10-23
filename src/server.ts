import { createServerEntry, createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

import { readClientId } from "#/lib/client-id";
import { defineLocaleHeaderStrategy } from "#/lib/locale.server";
import { createLogger } from "#/lib/logger.server";
import { logRequest } from "#/lib/request-log.server";
import { runWithTrace } from "#/lib/trace.server";
import { startMediaCleanup } from "#/orpc/media/cleanup.server";
import { deLocalizeHref } from "#/paraglide/runtime";
import { paraglideMiddleware } from "#/paraglide/server";

import { getRouter } from "./router";

const log = createLogger("http");

/*===== Background Jobs =====*/
// The server entry is loaded once when the server starts, which makes it the place to start in-process jobs.
startMediaCleanup();

/*===== Locale =====*/
// The strategy `/rpc` requests resolve their locale with (`project.inlang/paraglide.config.ts`).
defineLocaleHeaderStrategy();

/*===== Route Patterns =====*/
// A router kept only to match paths: it never loads or renders anything.
const routeMatcher = getRouter();

/**
 * The route pattern a path matched (`/notes/$id`), so the request log and slow-request reports group a route's
 * requests together, in every locale (`/en/notes/…` too). Paths no route matches (server functions, assets, 404s)
 * are returned as they are.
 */
function routePattern(path: string): string {
  const [, , foundRoute] = routeMatcher.getMatchedRoutes(deLocalizeHref(path));
  return foundRoute?.fullPath ?? path;
}

/*===== Request Handling =====*/
/** Sets a header, copying the response first when its headers are immutable (`Response.redirect`, a proxied fetch). */
function withHeader({ response, name, value }: { response: Response; name: string; value: string }): Response {
  try {
    response.headers.set(name, value);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    copy.headers.set(name, value);
    return copy;
  }
}

const handleRequest = createStartHandler(defaultStreamHandler);

/**
 * Start's handler, wrapped so every request (pages, server functions, `/rpc/*`, `/api/auth/*`, 404s) runs inside its
 * own trace. Everything it does, down to its queries, records into that trace, and log lines carry its `reqId`
 * (docs/backend/logging.md). The time ends when the response starts: streamed content that resolves later isn't counted.
 *
 * Inside the trace, `paraglideMiddleware` resolves the request's locale and keeps it for everything the request runs,
 * so `getLocale()` and every message follow it (docs/frontend/i18n.md). Start gets the request as it came, prefix
 * included: the router's `rewrite` (`src/router.tsx`) removes it, so the server's router sees the same URL as the
 * browser's.
 */
export default createServerEntry({
  fetch(request, opts) {
    // The path without its query string, which can carry tokens.
    const line = { method: request.method, path: new URL(request.url).pathname };
    const clientId = readClientId(request.headers.get("cookie"));

    return runWithTrace({ ...line, clientId }, async (trace) => {
      let response: Response;
      try {
        response = await paraglideMiddleware(request, () => handleRequest(request, opts));
      } catch (error) {
        // Start turns route and render errors into responses; only a failure of the handler itself lands here.
        log.error({ err: error }, "unhandled request error");
        response = new Response("Internal Server Error", { status: 500 });
      }

      // Shows in the browser's devtools, so a bug report can quote the ID its log lines carry.
      response = withHeader({ response, name: "X-Request-Id", value: trace.id });
      logRequest({ request: line, status: response.status, route: routePattern(line.path), trace });
      return response;
    });
  },
});
