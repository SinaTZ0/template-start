import { Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient } from "effect/http";
import { Otlp } from "effect/observability";

import { AppConfig } from "#/server/config.server";

/*===== OTLP Export =====*/
/**
 * Sends traces, logs and metrics to an OpenTelemetry backend over OTLP/HTTP (OpenObserve, docs/backend/logging.md →
 * OpenTelemetry), when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; without it, nothing leaves the server. Spans are named by
 * `Effect.fn`, SQL statements carry their text but never their parameters, and log lines arrive as the stdout lines
 * do, redacted.
 *
 * Its logger joins the app's (rather than replacing them), and its tracer is the one the request collector wraps, so
 * both are provided under them (`ObservabilityLive`).
 */
export const ExportLive = Layer.unwrap(
  Effect.gen(function* () {
    const { otlp, isDevelopment } = yield* AppConfig;
    return Option.match(otlp, {
      onNone: () => Layer.empty,
      onSome: ({ baseUrl, authorization }) =>
        Otlp.layerJson({
          baseUrl,
          headers: Option.match(authorization, {
            onNone: () => ({}),
            onSome: (value) => ({ Authorization: Redacted.value(value) }),
          }),
          resource: {
            serviceName: "app",
            // The build's commit, as error reports carry it (`vite.config.ts`).
            serviceVersion: import.meta.env?.APP_RELEASE || undefined,
            attributes: { "deployment.environment.name": isDevelopment ? "development" : "production" },
          },
          loggerMergeWithExisting: true,
        }).pipe(Layer.provide(FetchHttpClient.layer)),
    });
  }),
);
