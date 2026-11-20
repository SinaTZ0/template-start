import { performance } from "node:perf_hooks";

import { Cause, Context, Effect, Exit, Layer, Metric, Option, Tracer } from "effect";

import { redactText } from "#/lib/redact.server";
import { AppConfig } from "#/server/config.server";
import { writeLog } from "#/server/observability/log.server";
import { dbOperationDuration } from "#/server/observability/metrics.server";
import { sqlText } from "#/server/observability/sql-text";
import { spanKind } from "#/server/observability/timeline";
import type { CollectedSpan, SpanKind } from "#/server/observability/timeline";

/*===== Collected Requests =====*/
// A loop of queries would otherwise grow one request's record without bound. Past this, spans still count towards the
// totals but not in the timeline.
const MAX_SPANS = 300;

/** What a request's spans add up to, kept until the request ends. */
export type RequestRecord = {
  /** When the request's root span started (`performance.now()`). */
  start: number;
  spans: CollectedSpan[];
  /** Count and total time per kind, every span included; in the order each kind first ran. */
  totals: Partial<Record<SpanKind, { count: number; ms: number }>>;
};

const requests = new Map<string, RequestRecord>();

/**
 * Hands over a request's spans once its root span has ended, and stops keeping them. Called by the server entry for
 * the request's line and, when it was slow, its timeline (`#/server/observability/http.server`).
 */
export function takeRequestRecord(traceId: string): RequestRecord | undefined {
  const record = requests.get(traceId);
  requests.delete(traceId);
  return record;
}

/*===== Outcomes =====*/
/**
 * The exit a span is exported with. Effect's exporter marks every failed span as an error, but a typed failure
 * (`NoteNotFound`, `Unauthorized`, `RateLimited`) is an expected outcome: a signed-out visitor would otherwise fill the
 * backend's error list. Such a span ends as a success that names the failure (`app.outcome`). An interruption ends
 * as it is. A defect ends as an error, and so does any failure of an entry span: a request's, which fails only for a
 * 5xx, and a job run's, for which any failure is a failed run. So does a failure of a span that names an error
 * (`error.type`): the boundary sets it when a typed failure is answered with a 5xx (`effectProcedure`). An error is
 * exported with its text redacted (`redactedFailure`).
 */
function exportedExit({
  span,
  exit,
  isEntry,
}: {
  span: Tracer.Span;
  exit: Exit.Exit<unknown, unknown>;
  isEntry: boolean;
}) {
  if (exit._tag === "Success" || Cause.hasInterruptsOnly(exit.cause)) return exit;
  if (isEntry || Cause.hasDies(exit.cause) || namesError(span)) return redactedFailure(exit.cause);
  const failure = Cause.findError(exit.cause);
  const tag = failure._tag === "Success" ? (failure.success as { _tag?: unknown } | null)?._tag : undefined;
  span.attribute("app.outcome", typeof tag === "string" ? tag : "failure");
  return Exit.void;
}

/** Whether the code that ran the span marked its failure as an error, with OpenTelemetry's attribute for one. */
function namesError(span: Tracer.Span): boolean {
  return span.attributes.has("error.type");
}

/**
 * The failure a span is exported with: the same errors, as the exporter would render them (name, message, stack with
 * the spans it ran in), with secrets in their text redacted like a log line's (`#/lib/redact.server`). The exporter
 * copies an error's message and stack into the span as they are, and an error can quote what it failed on.
 */
function redactedFailure(cause: Cause.Cause<unknown>): Exit.Exit<never, never> {
  const errors = Cause.prettyErrors(cause, { includeCauseInStack: true }).map(({ name, message, stack }) => ({
    name,
    message: redactText(message),
    stack: redactText(stack ?? `${name}: ${message}`),
  }));
  return Exit.failCause(Cause.fromReasons(errors.map((error) => Cause.makeDieReason(error))));
}

/*===== Database Metric =====*/
const noServices = Context.empty();
const operations = new Map<string, Metric.Metric<number, unknown>>();

/** Counts a statement's time under its first keyword (`SELECT`, `INSERT`, `WITH`…): a handful of values, never the text. */
function recordStatement({ sql, system, ms }: { sql: string; system: unknown; ms: number }) {
  const operation = /^\s*([a-z]+)/i.exec(sql)?.[1]?.toUpperCase() ?? "OTHER";
  let metric = operations.get(operation);
  if (!metric) {
    metric = dbOperationDuration.pipe(
      Metric.withAttributes({
        "db.system.name": typeof system === "string" ? system : "postgresql",
        "db.operation.name": operation,
      }),
    );
    operations.set(operation, metric);
  }
  metric.updateUnsafe(ms / 1000, noServices);
}

/*===== Tracer =====*/
/**
 * Wraps the tracer spans are exported with (Effect's own, or OTLP's) to also:
 *
 * - keep every span of a request whose root span is open, for its line and timeline. A root span is one of kind
 *   `server` without a parent: the server entry's, one per request.
 * - write a `slow query` line for a statement at least `slowQueryMs` long, inside a request or not. It isn't reported:
 *   the slow request it belongs to is.
 * - count every statement's time (`db.client.operation.duration`).
 * - export a span that ended in an expected failure as a success (`exportedExit`).
 *
 * A span counts as failed when its exit carries a defect, or it names an error (`error.type`). Any other typed failure
 * (`NoteNotFound`) is an expected outcome.
 */
function collectingTracer({ base, slowQueryMs }: { base: Tracer.Tracer; slowQueryMs: number }): Tracer.Tracer {
  return Tracer.make({
    span(options) {
      const span = base.span(options);
      const start = performance.now();
      const isRoot = Option.isNone(options.parent) && options.kind === "server";
      if (isRoot) requests.set(span.traceId, { start, spans: [], totals: {} });

      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exportedExit({ span, exit, isEntry: options.kind === "server" || options.kind === "consumer" }));
        const ms = performance.now() - start;
        const query = span.attributes.get("db.query.text");
        const sql = typeof query === "string" ? sqlText(query) : undefined;
        const kind: SpanKind = isRoot ? "http" : spanKind({ name: span.name, sql });
        if (typeof query === "string") {
          recordStatement({ sql: query, system: span.attributes.get("db.system.name"), ms });
        }

        if (sql !== undefined && ms >= slowQueryMs) {
          writeLog({
            level: "warn",
            module: "db",
            message: "slow query",
            fields: { sql, ms: Math.round(ms) },
            context: { traceId: span.traceId, spanId: span.spanId },
          });
        }

        const record = requests.get(span.traceId);
        if (!record) return;
        if (kind !== "http") {
          const total = (record.totals[kind] ??= { count: 0, ms: 0 });
          total.count += 1;
          total.ms += ms;
        }
        if (record.spans.length >= MAX_SPANS && kind !== "http") return;
        record.spans.push({
          id: span.spanId,
          parent: Option.getOrUndefined(options.parent)?.spanId,
          kind,
          name: sql ?? span.name,
          at: start - record.start,
          ms,
          failed: exit._tag === "Failure" && (Cause.hasDies(exit.cause) || namesError(span)),
        });
      };
      return span;
    },
    context: base.context,
  });
}

/**
 * The app's tracer: whichever tracer is in place when this layer is built (OTLP's when exporting, Effect's own
 * otherwise), wrapped by the request collector.
 */
export const RequestSpansLive = Layer.unwrap(
  Effect.gen(function* () {
    const base = yield* Effect.tracer;
    const { log } = yield* AppConfig;
    return Layer.succeed(Tracer.Tracer, collectingTracer({ base, slowQueryMs: log.slowQueryMs }));
  }),
);
