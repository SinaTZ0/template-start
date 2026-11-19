// Loads `.env` and validates every variable at startup, as before. Until the rest of the server reads `AppConfig`,
// both see the same values.
import "#/env.server";

import { Config, Context, Effect, Layer } from "effect";
import type { Redacted } from "effect";

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
    readonly databaseUrl: Redacted.Redacted;
    /** Whether a failed query's parameters may be logged and reported. They can hold personal data. */
    readonly logQueryParams: boolean;
  }
>()("app/server/AppConfig") {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const databaseUrl = yield* Config.Redacted("DATABASE_URL");
      const logQueryParams = yield* Config.Boolean("LOG_QUERY_PARAMS").pipe(Config.withDefault(false));
      return AppConfig.of({ databaseUrl, logQueryParams });
    }),
  );
}
