import { AsyncLocalStorage } from "node:async_hooks";

import { Effect } from "effect";
import type { Tracer } from "effect";

/*===== Request Scope =====*/
/**
 * What the server knows about the request being handled, set by the server entry (`src/server.ts`) around the
 * framework's handler. It carries the request's root span across framework code (Start's rendering, its loaders,
 * Better-Auth), so the Effects those start join the request's trace, and it tags the log lines and error reports that
 * code writes outside any fiber.
 *
 * Effect code doesn't read it: a boundary reads it once, outside the fiber, where it runs the Effect (`joinRequest`).
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

/*===== Joining the Request =====*/
/**
 * Makes an Effect part of the request being handled: its spans go under the request's root span, so they count in the
 * request's line and timeline and export as one trace, and its log lines carry the request's client and user.
 * Outside a request (startup, jobs, scripts, tests) the Effect is returned as it is.
 *
 * Every boundary that runs an Effect during a request applies it: `effectProcedure`, the server routes outside oRPC
 * (`runInRequest`, `#/server/runtime.server`) and Better-Auth's callbacks (`#/server/auth.server`). Without it the
 * Effect starts a trace of its own, which the request never sees.
 *
 * Call it where the Effect is run, never inside Effect code: the scope is read here, at the call.
 */
export function joinRequest<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  const scope = storage.getStore();
  if (!scope) return effect;
  return effect.pipe(
    Effect.annotateLogs({
      ...(scope.clientId && { clientId: scope.clientId }),
      ...(scope.userId && { userId: scope.userId }),
    }),
    Effect.withParentSpan(scope.span),
  );
}
