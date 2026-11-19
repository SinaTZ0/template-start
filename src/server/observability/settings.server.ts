import { Config, ConfigProvider, Effect } from "effect";

import { serverEnv } from "#/server/config.server";

/*===== Observability Settings =====*/
/**
 * The settings logging and error reporting need before the runtime exists, and outside it (Better-Auth's callbacks,
 * the server entry): read once, synchronously, when the server starts. A malformed value stops the start. The rest of
 * the server's settings are `AppConfig`'s.
 */
export const observabilitySettings = Effect.runSync(
  Effect.gen(function* () {
    return {
      /** Lines below this level aren't written; `silent` writes none (and reports none). */
      logLevel: yield* Config.Literals(
        ["trace", "debug", "info", "warn", "error", "fatal", "silent"],
        "LOG_LEVEL",
      ).pipe(Config.withDefault("info" as const)),
      /** Whether a failed query's parameters may be logged and reported. They can hold personal data. */
      queryParams: yield* Config.Boolean("LOG_QUERY_PARAMS").pipe(Config.withDefault(false)),
      /** Where errors and slow requests are reported (the error viewer). Empty turns reporting off. */
      sentryDsn: yield* Config.String("SENTRY_DSN").pipe(Config.withDefault("")),
      environment: yield* Config.String("NODE_ENV").pipe(Config.withDefault("development")),
    };
  }).pipe(Effect.provideService(ConfigProvider.ConfigProvider, serverEnv)),
);
