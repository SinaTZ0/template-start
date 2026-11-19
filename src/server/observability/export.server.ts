import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient } from "effect/http";
import { OtlpExporter, OtlpMetrics, OtlpResource, OtlpSerialization, OtlpTracer } from "effect/observability";

import { AppConfig, serverEnv } from "#/server/config.server";
import { setLogExport } from "#/server/observability/log.server";
import type { ExportedLog, LogLevel } from "#/server/observability/log.server";
import { ProcessMetricsLive } from "#/server/observability/metrics.server";

/*===== Log Records =====*/
/** OpenTelemetry's severity numbers: the first of each level's range. */
const SEVERITY: Record<LogLevel, number> = { trace: 1, debug: 5, info: 9, warn: 13, error: 17, fatal: 21 };

/** How deep a field's nested objects are spread into dotted attribute names (`request.status`) before being printed. */
const MAX_ATTRIBUTE_DEPTH = 3;

/** Spreads nested objects into dotted names, since a record's attributes are flat. */
function flatten(fields: Record<string, unknown>, prefix = "", depth = 0, into: Record<string, unknown> = {}) {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const name = `${prefix}${key}`;
    const nested = typeof value === "object" && !Array.isArray(value) && depth < MAX_ATTRIBUTE_DEPTH;
    if (nested) flatten(value as Record<string, unknown>, `${name}.`, depth + 1, into);
    else into[name] = value;
  }
  return into;
}

/**
 * A log line as an OTLP log record. Its `traceId` and `spanId` tie it to the span it was written in, so the backend
 * shows a request's lines next to its trace. The error, when there is one, uses the conventions' `exception.*` names.
 */
function toLogRecord({ level, time, module, message, fields, err, context }: ExportedLog) {
  const error = err as { type?: unknown; message?: unknown; stack?: unknown } | undefined;
  const nanos = String(BigInt(time.getTime()) * 1_000_000n);
  return {
    timeUnixNano: nanos,
    observedTimeUnixNano: nanos,
    severityNumber: SEVERITY[level],
    severityText: level.toUpperCase(),
    body: { stringValue: message },
    attributes: OtlpResource.entriesToAttributes(
      Object.entries({
        module,
        ...flatten(fields),
        ...(context.userId && { "user.id": context.userId }),
        ...(context.clientId && { clientId: context.clientId }),
        ...(typeof error?.type === "string" && { "exception.type": error.type }),
        ...(typeof error?.message === "string" && { "exception.message": error.message }),
        ...(typeof error?.stack === "string" && { "exception.stacktrace": error.stack }),
      }),
    ),
    droppedAttributesCount: 0,
    ...(context.traceId && { traceId: context.traceId }),
    ...(context.traceId && context.spanId && { spanId: context.spanId }),
  };
}

type ExportOptions = {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly resource: {
    readonly serviceName: string;
    readonly serviceVersion: string | undefined;
    readonly attributes: Record<string, unknown>;
  };
};

/**
 * Exports the server's log lines. Not Effect's own OTLP logger: that one sends a line's fields as they are, and only
 * the lines Effect code writes. This one is fed by the log writer (`writeLog`), so every line goes out, redacted
 * exactly as stdout got it.
 */
const OtlpLogs = ({ url, headers, resource }: ExportOptions) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const serialization = yield* OtlpSerialization.OtlpSerialization;
      const otelResource = yield* OtlpResource.fromConfig(resource);
      const exporter = yield* OtlpExporter.make({
        label: "OtlpLogger",
        url,
        headers,
        exportInterval: "1 second",
        maxBatchSize: 1000,
        shutdownTimeout: "3 seconds",
        body: (logRecords) => [
          serialization.logs({
            resourceLogs: [
              { resource: otelResource, scopeLogs: [{ scope: { name: resource.serviceName }, logRecords }] },
            ],
          }),
          Effect.void,
        ],
      });
      yield* Effect.acquireRelease(
        Effect.sync(() => setLogExport((entry) => exporter.push(toLogRecord(entry)))),
        () => Effect.sync(() => setLogExport(undefined)),
      );
    }),
  ).pipe(Layer.provideMerge(OtlpExporter.layerFlusher));

/*===== OTLP Export =====*/
/**
 * Sends traces, metrics and logs to an OpenTelemetry backend over OTLP/HTTP (OpenObserve, docs/backend/logging.md →
 * OpenTelemetry), when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; without it, nothing leaves the server. The settings are
 * OpenTelemetry's own variables (`OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`), so
 * any OTLP backend's setup instructions apply as written.
 *
 * - **Traces.** Spans are named by `Effect.fn`; SQL statements carry their text but never their parameters.
 * - **Metrics** (`#/server/observability/metrics.server`), every 10 seconds, with the process's own while exporting.
 * - **Logs.** Every line the server writes, redacted, with the trace and span it was written in.
 *
 * Its tracer is the one the request collector wraps, so it is provided under it (`ObservabilityLive`).
 */
export const ExportLive = Layer.unwrap(
  Effect.gen(function* () {
    const { otlp, isDevelopment } = yield* AppConfig;
    if (Option.isNone(otlp)) return Layer.empty;
    const { baseUrl, serviceName } = otlp.value;
    const headers = Redacted.value(otlp.value.headers);
    const resource = {
      serviceName,
      // The build's commit, as error reports carry it (`vite.config.ts`).
      serviceVersion: import.meta.env?.APP_RELEASE || undefined,
      attributes: { "deployment.environment.name": isDevelopment ? "development" : "production" },
    };
    return Layer.mergeAll(
      OtlpTracer.layer({ url: `${baseUrl}/v1/traces`, headers, resource }),
      OtlpMetrics.layer({ url: `${baseUrl}/v1/metrics`, headers, resource }),
      OtlpLogs({ url: `${baseUrl}/v1/logs`, headers, resource }),
      ProcessMetricsLive,
    ).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer));
  }),
  // `OTEL_RESOURCE_ATTRIBUTES` is read by Effect's exporters themselves: from the process, like every other setting.
).pipe(Layer.provide(ConfigProvider.layer(serverEnv)));
