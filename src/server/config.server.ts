// Loads `.env` and validates every variable at startup, as before. Until the rest of the server reads `AppConfig`,
// both see the same values.
import "#/env.server";

import { Config, Context, Effect, Layer, Redacted } from "effect";

/*===== App Config =====*/
/**
 * The server's settings, read from the environment once when the runtime is built. A missing or malformed variable
 * fails the build of the runtime, so the server fails at startup rather than on first use.
 *
 * Secrets are `Redacted`: logging or serializing one prints `<redacted>`, and only `Redacted.value` reveals it.
 */
export class AppConfig extends Context.Service<
  AppConfig,
  {
    readonly isDevelopment: boolean;
    readonly databaseUrl: Redacted.Redacted;
    /** Whether a failed query's parameters may be logged and reported. They can hold personal data. */
    readonly logQueryParams: boolean;
    /**
     * The site's public address (`BETTER_AUTH_URL`): Better-Auth's base URL, and the origin of every absolute link.
     * Taken from the configuration rather than the request's host, which a proxy or a crafted `Host` header can change.
     */
    readonly siteUrl: URL;
    /** Signs session cookies and tokens. Rotating it signs every user out. */
    readonly authSecret: Redacted.Redacted;
    /** The one mailbox the app sends from (docs/backend/mail.md). */
    readonly smtp: {
      readonly host: string;
      /** 465 is TLS from the first byte; any other port starts plain and upgrades with STARTTLS. */
      readonly port: number;
      /** Empty for a server without login (Mailpit). */
      readonly user: string;
      readonly password: Redacted.Redacted;
      /** The address every email is sent from. */
      readonly from: string;
    };
  }
>()("app/server/AppConfig") {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const nodeEnv = yield* Config.Literals(["development", "production", "test"], "NODE_ENV").pipe(
        Config.withDefault("development" as const),
      );
      return AppConfig.of({
        isDevelopment: nodeEnv === "development",
        databaseUrl: yield* Config.Redacted("DATABASE_URL"),
        logQueryParams: yield* Config.Boolean("LOG_QUERY_PARAMS").pipe(Config.withDefault(false)),
        siteUrl: yield* Config.URL("BETTER_AUTH_URL"),
        authSecret: yield* Config.Redacted("BETTER_AUTH_SECRET"),
        smtp: {
          host: yield* Config.NonEmptyString("SMTP_HOST"),
          port: yield* Config.Port("SMTP_PORT").pipe(Config.withDefault(587)),
          user: yield* Config.String("SMTP_USER").pipe(Config.withDefault("")),
          password: yield* Config.Redacted("SMTP_PASSWORD").pipe(Config.withDefault(Redacted.make(""))),
          from: yield* Config.NonEmptyString("MAIL_FROM"),
        },
      });
    }),
  );
}
