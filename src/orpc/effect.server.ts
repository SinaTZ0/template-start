import { COMMON_ERROR_STATUS_MAP, ORPCError } from "@orpc/server";
import { Cause, Effect, Exit, Result } from "effect";

import { rateLimitedMessage } from "#/lib/rate-limit.server";
import type { RateLimitPolicy } from "#/lib/rate-limit.server";
import { issueToErrorData } from "#/lib/schema";
import type { UserRole } from "#/lib/user-constants";
import { ERROR_STATUS_MAP, noErrorData } from "#/orpc/errors";
import { m } from "#/paraglide/messages";
import { Captcha } from "#/server/captcha.server";
import type { CaptchaFailed, Forbidden, InvalidInput, RateLimited, Unauthorized } from "#/server/errors";
import { createLogger } from "#/server/observability/log.server";
import { joinRequest, requestScope } from "#/server/observability/request-scope.server";
import { checkRateLimit } from "#/server/rate-limit.server";
import { CurrentUser, RequestContext, requireRole, requireUser } from "#/server/request-context.server";
import { appRuntime } from "#/server/runtime.server";
import type { AppRuntime, AppServices } from "#/server/runtime.server";

const log = createLogger("orpc");

/*===== Policies =====*/
// Generous on purpose: many Iranian mobile users share one carrier address (CGNAT), and a page's loaders count too.
// Expensive procedures add their own, stricter policy (`rateLimit`).
const API_RATE_LIMIT: RateLimitPolicy = { name: "api", limit: 300, windowMs: 60_000 };

/*===== Types =====*/
/** Who may call: any signed-in user, or only the listed roles. Left out, the procedure is public. */
type Access = "user" | readonly UserRole[];

type Tagged = { readonly _tag: string };

/** The errors every procedure may meet, mapped here once (`commonError`). */
type CommonError = Unauthorized | Forbidden | InvalidInput | RateLimited | CaptchaFailed;

/** What a contract-first procedure from `base` offers: its `.handler`, typed by the contract. */
type ProcedureBuilder = { handler: (handler: never) => unknown };
type HandlerOf<P> = P extends { handler: (handler: infer H) => unknown } ? H : never;
type OptionsOf<P> = HandlerOf<P> extends (options: infer O, ...rest: never[]) => unknown ? O : never;
type InputOf<P> = OptionsOf<P> extends { input: infer I } ? I : never;
type ErrorsOf<P> = OptionsOf<P> extends { errors: infer E } ? E : never;
type OutputOf<P> = HandlerOf<P> extends (...args: never[]) => infer R ? Awaited<R> : never;

type TagOf<E> = E extends { readonly _tag: infer Tag extends string } ? Tag : never;

/**
 * One mapping per feature error the Effect can fail with: the contract error the client receives instead. A key is
 * required for every `_tag` in the error type, so a new error the service starts failing with doesn't compile until
 * each procedure that can receive it says what the client sees.
 */
type ErrorCases<E, Errors> = {
  readonly [Tag in TagOf<Exclude<E, CommonError>>]: (args: {
    readonly error: Extract<E, { readonly _tag: Tag }>;
    readonly errors: Errors;
  }) => ORPCError<string, unknown>;
};

/**
 * `access` is required exactly when the Effect requires `CurrentUser`: a public procedure that reads the user doesn't
 * compile, and the error names the missing `access`.
 */
type AccessOption<R> = [Extract<R, CurrentUser>] extends [never]
  ? { readonly access?: Access }
  : { readonly access: Access };

type Spec<P extends ProcedureBuilder, A, E, R> = {
  readonly run: (args: { readonly input: InputOf<P> }) => Effect.Effect<A, E, R>;
  readonly errors: ErrorCases<E, ErrorsOf<P>>;
  /** A stricter policy than the API's, for an expensive procedure. Counted before the session is read. */
  readonly rateLimit?: RateLimitPolicy;
  /**
   * For a public procedure that writes: the call must carry a solved captcha in `input.captcha`, which keeps scripts
   * from filling the tables. Its contract declares `captchaErrors`.
   */
  readonly captcha?: InputOf<P> extends { readonly captcha: string } ? true : never;
};

/*===== Common Errors =====*/
// The developer-facing `message`s stay English; what a person reads is in `data`, or worded by the UI
// (`#/lib/api-error`).
function commonError(error: Tagged): ORPCError<string, unknown> | undefined {
  switch (error._tag) {
    case "Unauthorized":
      return new ORPCError("UNAUTHORIZED", { message: "Sign in to continue.", data: noErrorData });
    case "Forbidden":
      return new ORPCError("FORBIDDEN", { message: "Your account can't do this.", data: noErrorData });
    case "InvalidInput":
      // Formatted here, after the fiber, in the request's own async context: the messages are in its locale.
      return new ORPCError("INVALID_INPUT", {
        message: "Invalid input.",
        data: issueToErrorData((error as InvalidInput).issue),
      });
    case "RateLimited":
      return new ORPCError("TOO_MANY_REQUESTS", {
        message: "Too many requests.",
        data: {
          errors: [rateLimitedMessage()],
          fields: {},
          retryAfterSeconds: (error as RateLimited).retryAfterSeconds,
        },
      });
    case "CaptchaFailed":
      return new ORPCError("CAPTCHA_FAILED", {
        message: "The security check failed.",
        data: { errors: [m.common_captcha_failed()], fields: {} },
      });
    default:
      return undefined;
  }
}

/*===== Server Failures =====*/
const COMMON_TAGS = new Set(["Unauthorized", "Forbidden", "InvalidInput", "RateLimited", "CaptchaFailed"]);

// As the HTTP handler answers them (`#/orpc/handler.server`): a code neither map knows is a 500.
const ERROR_STATUS: Record<string, number> = { ...COMMON_ERROR_STATUS_MAP, ...ERROR_STATUS_MAP };

/** Whether the client receives the contract error as a 5xx. */
function isServerError(error: ORPCError<string, unknown>): boolean {
  return (ERROR_STATUS[error.code] ?? 500) >= 500;
}

type ErrorMap = Record<string, (args: { error: Tagged; errors: unknown }) => ORPCError<string, unknown>>;

/**
 * The contract error a feature's typed failure is answered with, or `undefined` when no case maps it. Called twice
 * for a failure: inside the fiber, only to learn whether it is a 5xx, and after it, where the messages are in the
 * request's locale.
 */
function featureError({
  cases,
  error,
  errors,
}: {
  cases: ErrorMap;
  error: Tagged;
  errors: unknown;
}): ORPCError<string, unknown> | undefined {
  return cases[error._tag]?.({ error, errors });
}

/*===== Effect Procedure =====*/
/**
 * What a public procedure's Effect gets as `CurrentUser`: `AccessOption` keeps its code from asking for one, so this
 * is only for the types, and reading it is a bug.
 */
const noUser = new Proxy({} as CurrentUser["Service"], {
  get: () => {
    throw new Error("A public procedure read CurrentUser.");
  },
});

/**
 * Implements a contract procedure with an Effect, run on the app's runtime (`#/server/runtime.server`):
 *
 * ```ts
 * export const deleteNoteProcedure = effectProcedure(base.note.delete, {
 *   access: "user",
 *   run: ({ input }) => Effect.gen(function* () {
 *     const user = yield* CurrentUser;
 *     const notes = yield* NoteService;
 *     yield* notes.remove({ ownerId: user.id, id: input.id });
 *   }),
 *   errors: { NoteNotFound: ({ errors }) => errors.NOT_FOUND({ data: noErrorData }) },
 * });
 * ```
 *
 * In order, before `run`: the API's rate limit, the procedure's own (`rateLimit`), the captcha (`captcha`), then the
 * session (`access`), so a flood is turned away before any verification or session work.
 *
 * - **Access.** With `access`, the user is provided as `CurrentUser`. Without it, code that requires `CurrentUser`
 *   doesn't compile.
 * - **Expected failures** become contract errors: the common ones here, the feature's own through `errors`, which must
 *   name every one the Effect can fail with.
 * - **A failure answered with a 5xx** (`errors` maps it to `SERVICE_UNAVAILABLE`, say) is the server's failure, typed or
 *   not: the call's span ends as an error and the failure is logged, which reports it.
 * - **Defects** (a failed query, a bug) are logged once with an `errorId`, which the client receives in an
 *   `INTERNAL_SERVER_ERROR` and the error viewer is searched by.
 * - **A client that disconnects** interrupts the Effect, which rolls back its open transaction.
 * - **Tracing.** The call is an `rpc.<path>` span (`rpc.note.list`), over HTTP and in-process alike.
 */
export function effectProcedure<
  P extends ProcedureBuilder,
  A extends OutputOf<P>,
  E extends Tagged,
  R extends AppServices | RequestContext | CurrentUser,
>(procedure: P, spec: Spec<P, A, E, R> & AccessOption<R>): ReturnType<P["handler"]>;
export function effectProcedure(
  procedure: ProcedureBuilder,
  spec: Spec<ProcedureBuilder, unknown, Tagged, AppServices | RequestContext | CurrentUser> & {
    readonly access?: Access;
  },
): unknown {
  const handler = async ({
    input,
    context,
    errors,
    path,
    signal,
  }: {
    input: never;
    context: { headers: Headers; runtime?: AppRuntime };
    errors: unknown;
    path: readonly string[];
    signal?: AbortSignal;
  }) => {
    /*------ Run ------*/
    const { access, rateLimit, captcha } = spec;
    const cases = spec.errors as ErrorMap;
    // Read here, outside the fiber: the request this call belongs to, which learns who its user is.
    const scope = requestScope.current();
    const program = Effect.gen(function* () {
      yield* checkRateLimit(API_RATE_LIMIT);
      if (rateLimit) yield* checkRateLimit(rateLimit);
      if (captcha) {
        const verifier = yield* Captcha;
        yield* verifier.verify((input as { captcha: string }).captcha);
      }
      // A public procedure's Effect can't require `CurrentUser` (`AccessOption`), so the stand-in is never read.
      if (!access) return yield* spec.run({ input }).pipe(Effect.provideService(CurrentUser, noUser));
      const user = yield* access === "user" ? requireUser : requireRole(access);
      // The rest of the request's lines and reports carry the user's ID (never the email or name).
      if (scope) scope.userId = user.id;
      yield* Effect.annotateCurrentSpan("user.id", user.id);
      return yield* spec
        .run({ input })
        .pipe(Effect.provideService(CurrentUser, user), Effect.annotateLogs({ userId: user.id }));
    }).pipe(
      // A typed failure ends a span as a success that names it (docs/backend/logging.md), unless the client gets a
      // 5xx for it: then the span says what kind of error it was, and is exported as one.
      Effect.tapError((error) => {
        if (COMMON_TAGS.has(error._tag)) return Effect.void;
        const answer = featureError({ cases, error, errors });
        return answer && !isServerError(answer) ? Effect.void : Effect.annotateCurrentSpan("error.type", error._tag);
      }),
      Effect.withSpan(`rpc.${path.join(".")}`, { kind: "internal" }),
      Effect.annotateLogs({ module: "orpc" }),
      Effect.provideService(RequestContext, { headers: context.headers }),
    );

    // The call joins its request's trace, over HTTP and in-process alike.
    const exit = await (context.runtime ?? appRuntime).runPromiseExit(joinRequest(program), { signal });
    if (Exit.isSuccess(exit)) return exit.value;

    /*------ Expected Failures ------*/
    const failure = Cause.findError(exit.cause);
    if (Result.isSuccess(failure)) {
      // A typed failure of the Effect, or of building the runtime's layers (config, database), which maps to nothing.
      const error = failure.success as Tagged;
      const mapped = commonError(error) ?? featureError({ cases, error, errors });
      if (mapped) {
        // The client can't act on a 5xx, so someone has to hear of it: the line is also the error viewer's report.
        if (isServerError(mapped)) {
          log.error({ err: error, path: path.join("."), code: mapped.code }, "procedure failed");
        }
        throw mapped;
      }
    }

    /*------ Client Gone ------*/
    if (Cause.hasInterruptsOnly(exit.cause)) {
      throw new ORPCError("CLIENT_CLOSED_REQUEST", { message: "The client closed the request.", data: noErrorData });
    }

    /*------ Defects ------*/
    // Also a typed failure no case maps, which the types rule out unless a cast hid it.
    const errorId = crypto.randomUUID();
    const err = Cause.squash(exit.cause);
    log.error({ err, errorId, path: path.join("."), cause: Cause.pretty(exit.cause) }, "procedure failed");
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Internal server error.",
      data: { ...noErrorData, errorId },
      cause: err,
    });
  };
  return procedure.handler(handler as never);
}
