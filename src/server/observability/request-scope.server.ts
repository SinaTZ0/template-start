import { AsyncLocalStorage } from "node:async_hooks";

import type { Tracer } from "effect";

/*===== Request Scope =====*/
/**
 * What the server knows about the request being handled, set by the server entry (`src/server.ts`) around the
 * framework's handler. It carries the request's root span across framework code (Start's rendering, its loaders,
 * Better-Auth), so the Effects those start join the request's trace, and it tags the log lines and error reports that
 * code writes outside any fiber.
 *
 * Effect code doesn't read it: the oRPC boundary reads it once, outside the fiber, and passes what the Effect needs.
 */
export type RequestScope = {
  /** The request's trace ID: its log lines' `reqId`, its error reports' `reqId` tag and its `X-Request-Id` header. */
  readonly traceId: string;
  /** The request's root span, the parent of every span its Effects open. */
  readonly span: Tracer.AnySpan;
  readonly method: string;
  /** The path without its query string, which can carry tokens. */
  readonly path: string;
  /** The browser's random ID (`src/lib/client-id.ts`), when it sent one. */
  readonly clientId: string | undefined;
  /** The signed-in user's ID, once the session is read (`Auth.session`). Never the email or name. */
  userId: string | undefined;
};

const storage = new AsyncLocalStorage<RequestScope>();

export const requestScope = {
  /** Runs `fn` with `scope` as the current request's. */
  run: <T>(scope: RequestScope, fn: () => T): T => storage.run(scope, fn),
  /** The current request's scope, or `undefined` outside a request (startup, jobs, scripts). */
  current: (): RequestScope | undefined => storage.getStore(),
};
