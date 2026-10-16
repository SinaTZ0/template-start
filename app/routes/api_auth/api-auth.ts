import { auth } from "~/lib/auth.server";
import { limitRequest, RATE_LIMITED_MESSAGE, type RateLimitPolicy } from "~/lib/rate-limit.server";

import type { Route } from "./+types/api-auth";

/*===== Rate Limits =====*/
// The app's limiter replaces Better-Auth's (`rateLimit` is off in `auth.server.ts`), so the API and auth share one
// client address and one 429 shape. Endpoints that check a password or send mail get the strict policy. The mail ones
// don't exist until the project sends email, but are listed so they are covered once it does.
const CREDENTIAL_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/request-password-reset",
  "/reset-password",
  "/send-verification-email",
  "/change-password",
]);

// Per address, so a carrier address shared by many people (CGNAT) still leaves room for honest sign-ins.
const CREDENTIAL_RATE_LIMIT: RateLimitPolicy = { name: "auth-credentials", limit: 10, windowMs: 60_000 };
// Everything else, mostly session reads.
const AUTH_RATE_LIMIT: RateLimitPolicy = { name: "auth", limit: 120, windowMs: 60_000 };

/**
 * Answers over-limit requests with a 429 in Better-Auth's error shape, so the auth client reports it like any other
 * failure (`describeAuthError` shows the Persian line for status 429).
 */
export const middleware: Route.MiddlewareFunction[] = [
  ({ request }) => {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
    const policy = CREDENTIAL_PATHS.has(path) ? CREDENTIAL_RATE_LIMIT : AUTH_RATE_LIMIT;
    const result = limitRequest({ headers: request.headers, policy });
    if (result.allowed) return;

    return Response.json(
      { code: "TOO_MANY_REQUESTS", message: RATE_LIMITED_MESSAGE },
      { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
    );
  },
];

/*===== Better-Auth Endpoints =====*/
// Resource route (no default export): Better-Auth answers every `/api/auth/*` request itself.

export function loader({ request }: Route.LoaderArgs) {
  return auth.handler(request);
}

export function action({ request }: Route.ActionArgs) {
  return auth.handler(request);
}
