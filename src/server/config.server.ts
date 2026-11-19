import "#/server/load-env.server";

import { Config, ConfigProvider, Context, Effect, Layer, Option, Redacted, Schema } from "effect";

/*===== Source =====*/
/**
 * Where every setting is read from: the process's environment, and nothing else. Effect's default provider also reads
 * `import.meta.env`, which a Vite build freezes when it builds, and which holds `SENTRY_DSN` (the browser needs it,
 * `vite.config.ts`): the build's value would win over the one the server is started with.
 */
export const serverEnv = ConfigProvider.fromEnv({ env: process.env as Record<string, string> });

/*===== Checks =====*/
/** A secret long enough to sign with: shorter ones are refused at startup rather than weakening every token. */
const Secret = (name: string) =>
  Config.schema(Schema.String.check(Schema.isMinLength(32)), name).pipe(Config.map(Redacted.make));

/** An optional value whose empty string means "not set", as `.env` files write it. */
const OptionalString = (name: string) =>
  Config.String(name).pipe(Config.option, Config.map(Option.filter((value) => value !== "")));

/*===== App Config =====*/
/**
 * The server's settings, read from the environment once when the runtime is built. A missing or malformed variable
 * fails the build of the runtime, so the server fails at startup rather than on first use. Each variable is also in
 * `.env.example` and the `app` service in `compose.prod.yaml`; one that differs per deployment is in
 * `.env.production.example` and the deploy tool's settings (docs/deployment.md → Adding a Variable).
 *
 * Secrets are `Redacted`: logging or serializing one prints `<redacted>`, and only `Redacted.value` reveals it.
 */
export class AppConfig extends Context.Service<
  AppConfig,
  {
    readonly isDevelopment: boolean;
    readonly databaseUrl: Redacted.Redacted;
    readonly log: {
      /** A request at least this slow is a warning, and reported to the error viewer with its timeline. */
      readonly slowRequestMs: number;
      /** A query at least this slow gets its own warning line. */
      readonly slowQueryMs: number;
      /** Whether a failed query's parameters may be logged and reported. They can hold personal data. */
      readonly queryParams: boolean;
    };
    /** Where errors and slow requests are reported (the error viewer). None turns reporting off. */
    readonly sentryDsn: Option.Option<string>;
    /** Where traces and metrics are exported over OTLP/HTTP (OpenObserve). None turns export off. */
    readonly otlp: Option.Option<{
      readonly baseUrl: string;
      readonly authorization: Option.Option<Redacted.Redacted>;
    }>;
    /**
     * The site's public address (`BETTER_AUTH_URL`): Better-Auth's base URL, and the origin of every absolute link.
     * Taken from the configuration rather than the request's host, which a proxy or a crafted `Host` header can change.
     */
    readonly siteUrl: URL;
    /** Signs session cookies and tokens. Rotating it signs every user out. */
    readonly authSecret: Redacted.Redacted;
    /** Signs Altcha challenges, so a solution can be verified without storing the challenge. */
    readonly altchaKey: Redacted.Redacted;
    /** The S3-compatible bucket uploads live in (SeaweedFS in development; docs/backend/media.md). */
    readonly s3: {
      readonly endpoint: string;
      readonly bucket: string;
      readonly region: string;
      readonly accessKey: Redacted.Redacted;
      readonly secretKey: Redacted.Redacted;
    };
    /** Where browsers read images: a full URL (development, SeaweedFS) or a path behind the proxy (`/media`). */
    readonly mediaPublicUrl: string;
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
      const otlpEndpoint = yield* OptionalString("OTEL_EXPORTER_OTLP_ENDPOINT");
      const otlpAuthorization = yield* OptionalString("OTEL_EXPORTER_OTLP_AUTHORIZATION");
      return AppConfig.of({
        isDevelopment: nodeEnv === "development",
        databaseUrl: yield* Config.Redacted("DATABASE_URL"),
        log: {
          slowRequestMs: yield* Config.Int("LOG_SLOW_REQUEST_MS").pipe(Config.withDefault(1000)),
          slowQueryMs: yield* Config.Int("LOG_SLOW_QUERY_MS").pipe(Config.withDefault(200)),
          queryParams: yield* Config.Boolean("LOG_QUERY_PARAMS").pipe(Config.withDefault(false)),
        },
        sentryDsn: yield* OptionalString("SENTRY_DSN"),
        otlp: Option.map(otlpEndpoint, (baseUrl) => ({
          baseUrl: baseUrl.replace(/\/+$/, ""),
          authorization: Option.map(otlpAuthorization, Redacted.make),
        })),
        siteUrl: yield* Config.URL("BETTER_AUTH_URL"),
        authSecret: yield* Secret("BETTER_AUTH_SECRET"),
        altchaKey: yield* Secret("ALTCHA_HMAC_KEY"),
        s3: {
          endpoint: yield* Config.NonEmptyString("S3_ENDPOINT"),
          bucket: yield* Config.NonEmptyString("S3_BUCKET_NAME"),
          region: yield* Config.NonEmptyString("S3_REGION").pipe(Config.withDefault("us-east-1")),
          accessKey: yield* Config.Redacted("S3_ACCESS_KEY"),
          secretKey: yield* Config.Redacted("S3_SECRET_KEY"),
        },
        mediaPublicUrl: (yield* Config.NonEmptyString("MEDIA_PUBLIC_URL")).replace(/\/+$/, ""),
        smtp: {
          host: yield* Config.NonEmptyString("SMTP_HOST"),
          port: yield* Config.Port("SMTP_PORT").pipe(Config.withDefault(587)),
          user: yield* Config.String("SMTP_USER").pipe(Config.withDefault("")),
          password: yield* Config.Redacted("SMTP_PASSWORD").pipe(Config.withDefault(Redacted.make(""))),
          from: yield* Config.NonEmptyString("MAIL_FROM"),
        },
      });
    }),
  ).pipe(Layer.provide(ConfigProvider.layer(serverEnv)));
}
