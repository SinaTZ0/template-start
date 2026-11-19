import { Effect } from "effect";

import { limitRequest } from "#/lib/rate-limit.server";
import type { RateLimitPolicy } from "#/lib/rate-limit.server";
import { RateLimited } from "#/server/errors";
import { RequestContext } from "#/server/request-context.server";

/*===== Rate Limit =====*/
/**
 * Counts one call from the request's client address against `policy` (`#/lib/rate-limit.server`: fixed windows in
 * memory, per address, IPv6 by /64).
 *
 * @throws `RateLimited` with the seconds until the window ends, once the limit is reached.
 */
export const checkRateLimit = (policy: RateLimitPolicy): Effect.Effect<void, RateLimited, RequestContext> =>
  Effect.gen(function* () {
    const { headers } = yield* RequestContext;
    const result = limitRequest({ headers, policy });
    if (!result.allowed) return yield* new RateLimited({ retryAfterSeconds: result.retryAfterSeconds });
  });
