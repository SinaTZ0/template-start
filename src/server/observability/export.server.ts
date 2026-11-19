import { Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient } from "effect/http";
import { OtlpMetrics, OtlpSerialization, OtlpTracer } from "effect/observability";

import { AppConfig } from "#/server/config.server";

/*===== OTLP Export =====*/
/**
 * Sends traces and metrics to an OpenTelemetry backend over OTLP/HTTP (OpenObserve, docs/backend/logging.md →
 * OpenTelemetry), when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; without it, nothing leaves the server.
 *
 * - Spans are named by `Effect.fn`; SQL statements carry their text but never their parameters. A request's log lines
 *   travel inside its spans as events, redacted like the stdout lines (`#/server/observability/logger.server`).
 * - Log lines themselves aren't exported: Effect's OTLP logger would send their fields as they are, unredacted. They
 *   stay in the container's log, where Docker keeps them.
 *
 * Its tracer is the one the request collector wraps, so it is provided under it (`ObservabilityLive`).
 */
export const ExportLive = Layer.unwrap(
  Effect.gen(function* () {
    const { otlp, isDevelopment } = yield* AppConfig;
    return Option.match(otlp, {
      onNone: () => Layer.empty,
      onSome: ({ baseUrl, authorization }) => {
        const headers = Option.match(authorization, {
          onNone: () => ({}),
          onSome: (value) => ({ Authorization: Redacted.value(value) }),
        });
        const resource = {
          serviceName: "app",
          // The build's commit, as error reports carry it (`vite.config.ts`).
          serviceVersion: import.meta.env?.APP_RELEASE || undefined,
          attributes: { "deployment.environment.name": isDevelopment ? "development" : "production" },
        };
        return Layer.mergeAll(
          OtlpTracer.layer({ url: `${baseUrl}/v1/traces`, headers, resource }),
          OtlpMetrics.layer({ url: `${baseUrl}/v1/metrics`, headers, resource }),
        ).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer));
      },
    });
  }),
);
