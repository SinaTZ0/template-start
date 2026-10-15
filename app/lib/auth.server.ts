import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import * as schema from "~/db/schema";
import { env } from "~/env.server";
import { verifyAltchaPayload } from "~/lib/altcha.server";
import { ACCOUNT_BLOCKED_CODE, ALTCHA_HEADER, CAPTCHA_FAILED_CODE } from "~/lib/auth-constants";
import { createLogger } from "~/lib/logger.server";

const log = createLogger("auth");

/*===== Auth Instance =====*/
/**
 * Better-Auth server instance: email + password accounts with database sessions.
 *
 * Mounted at `/api/auth/*` (see `app/routes/api_auth/`). Server code reads the session with
 * `auth.api.getSession({ headers })`.
 */
export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Vite moves to the next free port (5174, …) when 5173 is taken, and Better-Auth rejects sign-in
  // and sign-up from any origin other than `baseURL`. Trust every local port in development only.
  trustedOrigins: env.NODE_ENV === "development" ? ["http://localhost:*", "http://127.0.0.1:*"] : [],
  // Better-Auth logs through `console` by default. Route it through the app's logger, which tags the request and
  // reports errors to the tracker; `LOG_LEVEL` decides what is written.
  logger: {
    level: "debug",
    log: (level, message, ...args: unknown[]) => {
      const err = args.find((arg) => arg instanceof Error);
      log[level](err ? { err } : args.length > 0 ? { details: args } : {}, message);
    },
  },
  emailAndPassword: {
    enabled: true,
    // No mail provider in the template: accounts work immediately, and sign-up signs the user in. Turn verification
    // on once the project can send email.
    requireEmailVerification: false,
    autoSignIn: true,
  },

  user: {
    additionalFields: {
      // Never from the client: everyone signs up as `user`; only server code promotes or blocks (`user-constants.ts`).
      role: { type: "string", required: false, defaultValue: "user", input: false },
      status: { type: "string", required: false, defaultValue: "active", input: false },
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      /*------ Sign-up Captcha ------*/
      // Better-Auth has no built-in Altcha provider, so the check runs here. The payload travels in a header because
      // the sign-up body only accepts user fields.
      if (ctx.path === "/sign-up/email") {
        const verified = await verifyAltchaPayload(ctx.headers?.get(ALTCHA_HEADER));
        if (!verified) {
          throw new APIError("BAD_REQUEST", { code: CAPTCHA_FAILED_CODE, message: "Captcha verification failed." });
        }
      }

      /*------ Blocked Accounts ------*/
      // A blocked account can't start a new session. Existing ones are revoked by the route guard and refused by the
      // API middleware.
      if (ctx.path === "/sign-in/email") {
        const email: unknown = ctx.body?.email;
        if (typeof email !== "string") return;
        const [blocked] = await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(and(eq(schema.user.email, email.toLowerCase()), eq(schema.user.status, "blocked")))
          .limit(1);
        if (blocked) throw new APIError("FORBIDDEN", { code: ACCOUNT_BLOCKED_CODE, message: "Account is blocked." });
      }
    }),
  },
});

export type AuthSession = typeof auth.$Infer.Session;

/*===== Session Revocation =====*/
/** Signs a user out everywhere by deleting all their sessions, e.g. once they are blocked. */
export async function revokeUserSessions(userId: string): Promise<void> {
  const context = await auth.$context;
  await context.internalAdapter.deleteUserSessions(userId);
}
