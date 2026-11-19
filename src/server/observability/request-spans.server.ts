import { performance } from "node:perf_hooks";

import { Cause, Effect, Layer, Option, Tracer } from "effect";

import { AppConfig } from "#/server/config.server";
import { writeLog } from "#/server/observability/log.server";
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

/*===== Tracer =====*/
/**
 * Wraps the tracer spans are exported with (Effect's own, or OTLP's) to also:
 *
 * - keep every span of a request whose root span is open, for its line and timeline. A root span is one of kind
 *   `server` without a parent: the server entry's, one per request.
 * - write a `slow query` line for a statement at least `slowQueryMs` long, inside a request or not. It isn't reported:
 *   the slow request it belongs to is.
 *
 * A span counts as failed when its exit carries a defect. A typed failure (`NoteNotFound`) is an expected outcome.
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
        end(endTime, exit);
        const ms = performance.now() - start;
        const query = span.attributes.get("db.query.text");
        const sql = typeof query === "string" ? sqlText(query) : undefined;
        const kind: SpanKind = isRoot ? "http" : spanKind({ name: span.name, sql });

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
          failed: exit._tag === "Failure" && Cause.hasDies(exit.cause),
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
