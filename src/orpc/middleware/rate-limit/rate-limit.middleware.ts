import { ORPCError, os } from "@orpc/server";

import { limitRequest, rateLimitedMessage, type RateLimitPolicy } from "#/lib/rate-limit.server";

/*===== Rate Limit =====*/
/**
 * Limits how often one client address may call the procedures it is applied to (`src/lib/rate-limit.server.ts`).
 *
 * `base` applies the general API policy to every procedure. Apply a stricter policy to an expensive procedure with
 * `.use()`, before its other middleware so a rejected call costs no session lookup. Calls from loaders through the
 * server client count too: they carry the page request's headers.
 *
 * @throws `TOO_MANY_REQUESTS` (a common error, `#/orpc/errors`) with `retryAfterSeconds` once the limit is reached.
 */
export function rateLimitMiddleware(policy: RateLimitPolicy) {
  return os.$context<{ headers: Headers }>().middleware(async ({ context, next }) => {
    assertWithinRateLimit({ headers: context.headers, policy });
    return next();
  });
}

/**
 * Counts one request against `policy`. Shared with the RPC handler, which checks before it reads the request body
 * (`#/orpc/handler.server`).
 *
 * @throws `TOO_MANY_REQUESTS` with `retryAfterSeconds` once the limit is reached.
 */
export function assertWithinRateLimit({ headers, policy }: { headers: Headers; policy: RateLimitPolicy }): void {
  const result = limitRequest({ headers, policy });
  if (result.allowed) return;
  throw new ORPCError("TOO_MANY_REQUESTS", {
    message: "Too many requests.",
    data: { errors: [rateLimitedMessage()], fields: {}, retryAfterSeconds: result.retryAfterSeconds },
  });
}
