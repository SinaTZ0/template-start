import { COMMON_ERROR_STATUS_MAP, ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RequestLimitHandlerPlugin } from "@orpc/server/plugins";

import { createLogger } from "#/server/observability/log.server";
import { limitRequest, rateLimitedMessage } from "#/lib/rate-limit.server";
import type { RateLimitPolicy } from "#/lib/rate-limit.server";
import { ERROR_STATUS_MAP } from "#/orpc/errors";
import { MEDIA_MAX_BYTES } from "#/orpc/media/constants";
import { router } from "#/orpc/router";

const log = createLogger("orpc");

/*===== Before The Body Is Read =====*/
// oRPC decodes the request body before any procedure middleware runs, so these two checks sit in front of it: a
// request they refuse costs no parsing.

// Their own counters, with the numbers of the policies the procedures apply (`#/orpc/effect.server`,
// `#/orpc/media/procedure`). Those also count the calls loaders make through the server client; sharing a counter
// would count every browser call twice.
const RPC_RATE_LIMIT: RateLimitPolicy = { name: "rpc", limit: 300, windowMs: 60_000 };
// An upload body is up to 11 MB of multipart to parse, signed in or not.
const RPC_UPLOAD_RATE_LIMIT: RateLimitPolicy = { name: "rpc-upload", limit: 20, windowMs: 60_000 };

/**
 * Refuses a request another site made. Browsers send `Origin` with every POST, and the session cookie is
 * `SameSite=Lax`, which still travels with requests from a sibling subdomain (the error viewer's, for one). Requests
 * without the header don't come from a page.
 *
 * @throws `FORBIDDEN` when `Origin` names a host other than the one the request was sent to.
 */
function assertSameOrigin(headers: Headers): void {
  const origin = headers.get("origin");
  if (!origin) return;
  const host = URL.canParse(origin) ? new URL(origin).host : null;
  if (host !== headers.get("host")) {
    throw new ORPCError("FORBIDDEN", { message: "Cross-origin request.", data: { errors: [], fields: {} } });
  }
}

/**
 * Counts the request against `policy`, before its body is read. Procedures count their own calls separately
 * (`effectProcedure`), which also covers the calls loaders make in-process.
 *
 * @throws `TOO_MANY_REQUESTS` with `retryAfterSeconds` once the limit is reached.
 */
function assertWithinRateLimit({ headers, policy }: { headers: Headers; policy: RateLimitPolicy }): void {
  const result = limitRequest({ headers, policy });
  if (result.allowed) return;
  throw new ORPCError("TOO_MANY_REQUESTS", {
    message: "Too many requests.",
    data: { errors: [rateLimitedMessage()], fields: {}, retryAfterSeconds: result.retryAfterSeconds },
  });
}

/*===== Body Size =====*/
/** Room for a procedure's JSON input. Caddy's own cap is far higher, to let uploads through (`deploy/Caddyfile`). */
const MAX_BODY_BYTES = 1024 * 1024;
/** An image of the largest accepted size, plus room for the multipart encoding. */
const MAX_UPLOAD_BODY_BYTES = MEDIA_MAX_BYTES + 1024 * 1024;

/** Paths (after `/rpc`) of the procedures that take a file. A new upload procedure is added here. */
const UPLOAD_PATHS = new Set(["/media/upload"]);

/*===== Malformed Bodies =====*/
/**
 * Whether the error is a request body that couldn't be decoded: broken JSON, or multipart data without its boundary.
 * oRPC answers those with `BAD_REQUEST`, but the interceptor sees the parser's own error first. Anyone can send one,
 * so it is a client error, and logging it as a server error would let a script fill the error viewer.
 */
function isMalformedBody(err: unknown): boolean {
  if (err instanceof SyntaxError) return true;
  return err instanceof TypeError && err.message.startsWith("Failed to parse body as FormData");
}

/*===== RPC Handler =====*/
function createHandler({ maxBodySize, rateLimit }: { maxBodySize: number; rateLimit: RateLimitPolicy }) {
  return new RPCHandler(router, {
    errorStatusMap: { ...COMMON_ERROR_STATUS_MAP, ...ERROR_STATUS_MAP },
    // Rejects a larger body with `PAYLOAD_TOO_LARGE`, also when it is sent without a `Content-Length`.
    plugins: [new RequestLimitHandlerPlugin({ maxBodySize })],
    interceptors: [
      // Failures before the procedure runs (e.g. an undecodable body) never reach middleware, so they are logged here.
      // The interceptor sees every error, though: client errors are expected (debug level), and server errors the
      // global middleware already logged carry an `errorId`.
      onError((err) => {
        if (!(err instanceof ORPCError) || err.code !== "INTERNAL_SERVER_ERROR") {
          if (err instanceof ORPCError) return log.debug({ err }, "client error");
          if (isMalformedBody(err)) return log.debug({ err }, "client error: malformed request body");
          return log.error({ err }, "handler error");
        }
        const errorId: unknown = (err.data as { errorId?: unknown } | undefined)?.errorId;
        if (typeof errorId !== "string") log.error({ err }, "handler error");
      }),
      // After `onError`, so a refusal is logged like any other client error.
      ({ context, next }) => {
        assertSameOrigin(context.headers);
        assertWithinRateLimit({ headers: context.headers, policy: rateLimit });
        return next();
      },
    ],
  });
}

const handler = createHandler({ maxBodySize: MAX_BODY_BYTES, rateLimit: RPC_RATE_LIMIT });
const uploadHandler = createHandler({ maxBodySize: MAX_UPLOAD_BODY_BYTES, rateLimit: RPC_UPLOAD_RATE_LIMIT });

/**
 * HTTP adapter for the API, mounted at `/rpc/*` (see `src/routes/rpc/`).
 *
 * Only POST is accepted (oRPC's default), so a cross-site navigation can't trigger a procedure with the user's
 * cookies. Before a body is read, the request must come from this site and be within the rate limit, and the body is
 * capped at 1 MB, or the upload size for the procedures in `UPLOAD_PATHS`.
 *
 * @param pathname The request's path, `/rpc` included.
 */
export function rpcHandlerFor(pathname: string) {
  return UPLOAD_PATHS.has(pathname.replace(/^\/rpc/, "")) ? uploadHandler : handler;
}
