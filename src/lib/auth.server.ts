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
  RESET_PASSWORD_LINK_HOURS,
  VERIFY_EMAIL_LINK_HOURS,
} from "#/lib/auth-constants";
import { LOCALE_HEADER } from "#/lib/locale";
import { createLogger } from "#/lib/logger.server";
import { normalizePersianText } from "#/lib/persian-text";
import { CLIENT_ADDRESS_HEADER } from "#/lib/rate-limit.server";
import { SITE_ORIGIN } from "#/lib/site.server";
import { setTraceUser } from "#/lib/trace.server";
import { queueMail } from "#/mail/jobs.server";
import type { MailTemplate } from "#/mail/render.server";
import { baseLocale, isLocale, localizeHref, type Locale } from "#/paraglide/runtime";

const log = createLogger("auth");

/*===== Emails =====*/
/**
 * The language the person asking reads: the auth client sends its page's locale in `x-locale`
 * (`src/lib/auth-client.ts`), since `/api/auth/*` paths carry none. The email goes out in it.
 */
function requestLocale(request: Request | undefined): Locale {
  const value = request?.headers.get(LOCALE_HEADER);
  return value && isLocale(value) ? value : baseLocale;
}

/**
 * Better-Auth's link with the page it lands on replaced by `path` in the email's language. The server picks it, not the
 * client: a sign-in that asks for a `callbackURL` is also redirected there when it succeeds, and the page belongs to the
 * email, not to whatever started it.
 */
function withLandingPage({ url, path, locale }: { url: string; path: string; locale: Locale }): string {
  const link = new URL(url);
  link.searchParams.set("callbackURL", localizeHref(path, { locale }));
  return link.toString();
}

/**
 * Queues an auth email (docs/backend/mail.md) without waiting for it. Better-Auth answers a request for an unknown
 * address without calling here at all, so a request that waited on the queue would take measurably longer for an
 * address that has an account, and the time would tell who does.
 */
function sendAuthMail({
  template,
  user,
  url,
  locale,
}: {
  template: MailTemplate;
  user: { email: string; name: string };
  url: string;
  locale: Locale;
}): void {
  const mail = { template, to: user.email, name: user.name, url, locale };
  queueMail(mail).catch((error: unknown) => log.error({ err: error, template }, "an auth email could not be queued"));
}

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
  /*------ Email and Password ------*/
  emailAndPassword: {
    enabled: true,
    // An account is used once its address is confirmed, so sign-up doesn't sign in: it sends the confirmation link.
    // It also answers an address that already has an account exactly like a new one, and emails the owner instead
    // (`onExistingUserSignUp`), so sign-up can't be used to find out who has an account.
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: RESET_PASSWORD_LINK_HOURS * 60 * 60,
    // A new password ends every session: whoever knew the old one is signed out too.
    revokeSessionsOnPasswordReset: true,
    // `url` is Better-Auth's own `/api/auth/reset-password/<token>`, which checks the token and sends the browser on to
    // `/reset-password`, token included (or `?error=INVALID_TOKEN`).
    sendResetPassword: async ({ user, url }, request) => {
      const locale = requestLocale(request);
      const link = withLandingPage({ url, path: "/reset-password", locale });
      sendAuthMail({ template: "reset-password", user, url: link, locale });
    },
    onExistingUserSignUp: async ({ user }, request) => {
      const locale = requestLocale(request);
      const url = `${SITE_ORIGIN}${localizeHref("/forgot-password", { locale })}`;
      sendAuthMail({ template: "account-exists", user, url, locale });
    },
  },

  /*------ Email Verification ------*/
  emailVerification: {
    sendOnSignUp: true,
    // Signing in before confirming sends a fresh link (with a 403 `EMAIL_NOT_VERIFIED`), so a lost or expired email is
    // never a dead end. Only after the password checked out, and the auth rate limit bounds how often.
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: VERIFY_EMAIL_LINK_HOURS * 60 * 60,
    // `url` is Better-Auth's `/api/auth/verify-email?token=…`, which confirms the address, signs in and sends the
    // browser on to `/verify-email` (with `?error=…` when the link has expired or was used).
    sendVerificationEmail: async ({ user, url }, request) => {
      const locale = requestLocale(request);
      const link = withLandingPage({ url, path: "/verify-email", locale });
      sendAuthMail({ template: "verify-email", user, url: link, locale });
    },
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
