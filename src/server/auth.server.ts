import { drizzle } from "drizzle-orm/node-postgres";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import { Pool } from "pg";

import { SendMail } from "#/mail/jobs.server";
import { createBetterAuth } from "#/server/better-auth.server";
import { Captcha } from "#/server/captcha.server";
import type { AuthSession, BetterAuth } from "#/server/better-auth.server";
import { AppConfig } from "#/server/config.server";
import { Jobs } from "#/server/jobs.server";
import { createLogger } from "#/server/observability/log.server";

const log = createLogger("auth");

/*===== Auth =====*/
/**
 * Better-Auth, built from the app's configuration (`#/server/better-auth.server`), and the session reads the rest of
 * the server makes through it. A failure here is a defect: the session store is the database.
 */
export class Auth extends Context.Service<
  Auth,
  {
    /** The Better-Auth server itself, for `/api/auth/*` and the seed. */
    readonly betterAuth: BetterAuth;
    /** The session the request's cookies belong to, if any. Its queries are this span's: the pool isn't traced. */
    readonly session: (headers: Headers) => Effect.Effect<Option.Option<AuthSession>>;
    /** Signs a user out everywhere by deleting all their sessions, e.g. once they are blocked. */
    readonly revokeSessions: (userId: string) => Effect.Effect<void>;
  }
>()("app/server/Auth") {
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      // Better-Auth's emails are queued on the app's own queue, from its callbacks outside any fiber.
      const context = yield* Effect.context<Jobs>();
      const captcha = yield* Captcha;

      /*------ Pool ------*/
      // Better-Auth's adapter speaks promises, so it gets a small pool of its own beside the app's (`PgLive`), closed
      // with the runtime. Without the timeouts, a stalled Postgres would hang every sign-in instead of failing it.
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const created = new Pool({
            connectionString: Redacted.value(config.databaseUrl),
            application_name: "auth",
            max: 5,
            connectionTimeoutMillis: 5_000,
            statement_timeout: 30_000,
            idle_in_transaction_session_timeout: 60_000,
          });
          // An idle connection Postgres closed is dropped by the pool; without a listener Node would exit.
          created.on("error", (error) => log.error({ err: error }, "idle auth database connection failed"));
          return created;
        }),
        (opened) => Effect.promise(() => opened.end()),
      );

      const betterAuth = createBetterAuth({
        config,
        db: drizzle({ client: pool }),
        queueMail: (mail) => Effect.runPromiseWith(context)(SendMail.enqueue(mail)),
        verifyCaptcha: (payload) =>
          Effect.runPromise(
            captcha.verify(payload).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            ),
          ),
      });

      return Auth.of({
        betterAuth,
        session: (headers) =>
          Effect.promise(() => betterAuth.api.getSession({ headers })).pipe(
            Effect.map(Option.fromNullishOr),
            Effect.withSpan("Auth.session"),
          ),
        revokeSessions: (userId) =>
          Effect.promise(async () => {
            const authContext = await betterAuth.$context;
            await authContext.internalAdapter.deleteUserSessions(userId);
          }).pipe(Effect.withSpan("Auth.revokeSessions")),
      });
    }),
  );

  /** A fixed session (or none) for tests of who gets past `access`. */
  static layerTest(session: () => AuthSession | null) {
    return Layer.succeed(
      Auth,
      Auth.of({
        betterAuth: undefined as never,
        session: () => Effect.sync(() => Option.fromNullishOr(session())),
        revokeSessions: () => Effect.void,
      }),
    );
  }
}
