import { ORPCError } from "@orpc/server";
import { Cause, Effect, Exit, Result } from "effect";

import { createLogger } from "#/lib/logger.server";
import { issueToErrorData } from "#/lib/schema";
import type { UserRole } from "#/lib/user-constants";
import { noErrorData } from "#/orpc/errors";
import type { Forbidden, InvalidInput, Unauthorized } from "#/server/errors";
import { CurrentUser, RequestContext, requireRole, requireUser } from "#/server/request-context.server";
import { appRuntime } from "#/server/runtime.server";
import type { AppServices } from "#/server/runtime.server";

const log = createLogger("orpc");

/*===== Types =====*/
/** Who may call: any signed-in user, or only the listed roles. Left out, the procedure is public. */
type Access = "user" | readonly UserRole[];

type Tagged = { readonly _tag: string };

/** The errors every procedure may meet, mapped here once (`commonCases`). */
type CommonError = Unauthorized | Forbidden | InvalidInput;

/** What a contract-first procedure from `base` offers: its `.handler`, typed by the contract. */
type ProcedureBuilder = { handler: (handler: never) => unknown };
type HandlerOf<P> = P extends { handler: (handler: infer H) => unknown } ? H : never;
type OptionsOf<P> = HandlerOf<P> extends (options: infer O, ...rest: never[]) => unknown ? O : never;
type InputOf<P> = OptionsOf<P> extends { input: infer I } ? I : never;
type ErrorsOf<P> = OptionsOf<P> extends { errors: infer E } ? E : never;
type OutputOf<P> = HandlerOf<P> extends (...args: never[]) => infer R ? Awaited<R> : never;

/**
 * One mapping per feature error the Effect can fail with: the contract error the client receives instead. A key is
 * required for every `_tag` in the error type, so a new error the service starts failing with doesn't compile until
 * each procedure that can receive it says what the client sees.
 */
type TagOf<E> = E extends { readonly _tag: infer Tag extends string } ? Tag : never;

type ErrorCases<E, Errors> = {
  readonly [Tag in TagOf<Exclude<E, CommonError>>]: (args: {
    readonly error: Extract<E, { readonly _tag: Tag }>;
    readonly errors: Errors;
  }) => ORPCError<string, unknown>;
};

type Spec<P extends ProcedureBuilder, A, E, R> = {
  readonly run: (args: { readonly input: InputOf<P> }) => Effect.Effect<A, E, R>;
  readonly errors: ErrorCases<E, ErrorsOf<P>>;
};

/*===== Common Errors =====*/
// The messages are for developers; the UI words a sign-in or role failure itself (`#/lib/api-error`).
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
    default:
      return undefined;
  }
}

/*===== Effect Procedure =====*/
const noUser = Effect.die(new Error("A public procedure required CurrentUser."));

/**
 * Implements a contract procedure with an Effect, run on the app's runtime (`#/server/runtime.server`):
 *
 * ```ts
 * export const deleteNoteProcedure = effectProcedure(base.note.delete, {
 *   access: "user",
 *   run: ({ input }) => Effect.gen(function* () {
 *     const user = yield* CurrentUser;
 *     yield* (yield* NoteService).remove({ ownerId: user.id, id: input.id });
 *   }),
 *   errors: { NoteNotFound: ({ errors }) => errors.NOT_FOUND({ data: noErrorData }) },
 * });
 * ```
 *
 * - **Access.** With `access`, the session is checked first and the user provided as `CurrentUser`. Without it,
 *   code that requires `CurrentUser` doesn't compile.
 * - **Expected failures** become contract errors: `Unauthorized`, `Forbidden` and `InvalidInput` here, the feature's
 *   own through `errors`, which must name every one the Effect can fail with.
 * - **Defects** (a failed query, a bug) are logged once with an `errorId`, which the client receives in an
 *   `INTERNAL_SERVER_ERROR` and the error viewer is searched by.
 * - **A client that disconnects** interrupts the Effect, which rolls back its open transaction.
 */
export function effectProcedure<
  P extends ProcedureBuilder,
  A extends OutputOf<P>,
  E extends Tagged,
  R extends AppServices | RequestContext | CurrentUser,
>(procedure: P, spec: Spec<P, A, E, R> & { readonly access: Access }): ReturnType<P["handler"]>;
export function effectProcedure<
  P extends ProcedureBuilder,
  A extends OutputOf<P>,
  E extends Tagged,
  R extends AppServices | RequestContext,
>(procedure: P, spec: Spec<P, A, E, R> & { readonly access?: undefined }): ReturnType<P["handler"]>;
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
    context: { headers: Headers };
    errors: unknown;
    path: readonly string[];
    signal?: AbortSignal;
  }) => {
    /*------ Run ------*/
    const { access } = spec;
    const program = Effect.gen(function* () {
      // A public procedure's Effect can't require `CurrentUser` (the overloads above), so this never runs.
      if (!access) return yield* spec.run({ input }).pipe(Effect.provideServiceEffect(CurrentUser, noUser));
      const user = yield* access === "user" ? requireUser : requireRole(access);
      return yield* spec.run({ input }).pipe(Effect.provideService(CurrentUser, user));
    }).pipe(Effect.provideService(RequestContext, { headers: context.headers }));

    const exit = await appRuntime.runPromiseExit(program, { signal });
    if (Exit.isSuccess(exit)) return exit.value;

    /*------ Expected Failures ------*/
    const failure = Cause.findError(exit.cause);
    if (Result.isSuccess(failure)) {
      const error = failure.success;
      const mapped =
        commonError(error) ??
        (spec.errors as Record<string, (args: { error: Tagged; errors: unknown }) => ORPCError<string, unknown>>)[
          error._tag
        ]?.({ error, errors });
      if (mapped) throw mapped;
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
