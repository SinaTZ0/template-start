import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import { db } from "#/db/client.server";
import * as schema from "#/db/schema";
import { env } from "#/env.server";
import { verifyAltchaPayload } from "#/lib/altcha.server";
import {
  ACCOUNT_BLOCKED_CODE,
  ALTCHA_HEADER,
  CAPTCHA_FAILED_CODE,
  NAME_MAX_LENGTH,
  NAME_REQUIRED_CODE,
  NAME_TOO_LONG_CODE,
} from "#/lib/auth-constants";
import { createLogger } from "#/lib/logger.server";
import { normalizePersianText } from "#/lib/persian-text";
import { CLIENT_ADDRESS_HEADER } from "#/lib/rate-limit.server";
import { setTraceUser } from "#/lib/trace.server";

const log = createLogger("auth");

/*===== Auth Instance =====*/
/**
 * Better-Auth server instance: email + password accounts with database sessions.
 *
 * Mounted at `/api/auth/*` (see `src/routes/api_auth/`). Server code reads the session with `getRequestSession`.
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
  // `/api/auth/*` is limited by the app's own limiter (`src/routes/api_auth/`). Better-Auth's would count the same
  // requests a second time, and without a client address it falls back to one bucket shared by every visitor.
  rateLimit: { enabled: false },
  // Sessions record the address the app's limiter trusts: Caddy sets it (`src/lib/rate-limit.server.ts`).
  advanced: { ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] } },
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

  /*------ Display Name ------*/
  // The name is the account's one free-text field, so it is normalized like the app's other free text
  // (`src/lib/persian-text.ts`), on sign-up and on every update. The email and password are left exactly as sent.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({ data: { ...user, name: normalizePersianText(user.name) } }),
      },
      update: {
        before: async (user) => ({
          data: typeof user.name === "string" ? { ...user, name: normalizePersianText(user.name) } : user,
        }),
      },
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      /*------ Display Name ------*/
      // Better-Auth only checks that the name is a string, so without this the request body limit would be its only
      // bound. Measured as it is stored, after normalization. First, so a rejected name doesn't use up a captcha.
      if (ctx.path === "/sign-up/email" || ctx.path === "/update-user") {
        const name: unknown = ctx.body?.name;
        if (typeof name === "string") {
          const length = normalizePersianText(name).length;
          if (length === 0) {
            throw new APIError("BAD_REQUEST", { code: NAME_REQUIRED_CODE, message: "Name is required." });
          }
          if (length > NAME_MAX_LENGTH) {
            throw new APIError("BAD_REQUEST", { code: NAME_TOO_LONG_CODE, message: "Name is too long." });
          }
        }
      }

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

/*===== Session =====*/
/**
 * The session the request's cookies belong to, or `null`. Read it through this rather than `auth.api.getSession`, so
 * the rest of the request's log lines and error reports carry the signed-in user's ID (`setTraceUser`).
 */
export async function getRequestSession(headers: Headers): Promise<AuthSession | null> {
  const session = await auth.api.getSession({ headers });
  if (session) setTraceUser(session.user.id);
  return session;
}

/*===== Session Revocation =====*/
/** Signs a user out everywhere by deleting all their sessions, e.g. once they are blocked. */
export async function revokeUserSessions(userId: string): Promise<void> {
  const context = await auth.$context;
  await context.internalAdapter.deleteUserSessions(userId);
}
