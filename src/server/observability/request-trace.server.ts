import { performance } from "node:perf_hooks";

import { Cause, Layer, Option, Tracer } from "effect";

import { currentSpanId, currentTrace, recordSpan } from "#/lib/trace.server";
import type { RequestTrace, SpanKind } from "#/lib/trace.server";
import { sqlText } from "#/server/observability/sql-text";

/*===== Span Kinds =====*/
// A span's kind comes from its name, which `Effect.fn("Owner.method")` sets: the request line and the slow-request
// timeline total and colour spans by kind (docs/backend/logging.md → Request Timing).
const REPOSITORY = /^[A-Za-z]+Repo\./;
const SERVICE = /^[A-Za-z]+Service\./;
const STORAGE = /^Storage\./;
const PROCEDURE = /^rpc\./;

function kindOf(span: Tracer.Span): SpanKind {
  if (span.attributes.has("db.query.text")) return "db";
  if (REPOSITORY.test(span.name)) return "repository";
  if (SERVICE.test(span.name)) return "service";
  if (STORAGE.test(span.name)) return "storage";
  if (PROCEDURE.test(span.name)) return "procedure";
  return "task";
}

/*===== Tracer =====*/
/** Where a span was recorded, so its children nest under it in the same request's timeline. */
const recorded = new WeakMap<Tracer.AnySpan, { trace: RequestTrace; id: number }>();

/**
 * Effect's tracer, recording every span of a request into that request's trace (`#/lib/trace.server`) as well, so
 * Effect code shows in the request line and the slow-request timeline beside the rest of the server.
 *
 * Spans nest under their Effect parent. A span with no Effect parent nests under the span the calling code runs in
 * (the procedure, when a procedure runs an Effect). Spans outside a request (a job, startup) are only Effect's.
 *
 * A span counts as failed when its exit carries a defect. A typed failure (`NoteNotFound`) is an expected outcome,
 * not a failure of the work.
 */
function requestTraceTracer(base: Tracer.Tracer): Tracer.Tracer {
  return Tracer.make({
    span(options) {
      const span = base.span(options);
      // The fiber runs in the async context it was started from, so this is the request that started it.
      const trace = currentTrace();
      if (!trace) return span;

      const effectParent = Option.isSome(options.parent) ? recorded.get(options.parent.value) : undefined;
      const parent = effectParent?.trace === trace ? effectParent.id : currentSpanId();
      const id = trace.nextSpanId++;
      const start = performance.now();
      recorded.set(span, { trace, id });

      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        const query = span.attributes.get("db.query.text");
        recordSpan({
          trace,
          parent,
          id,
          kind: kindOf(span),
          name: query === undefined ? span.name : sqlText(query),
          start,
          failed: exit._tag === "Failure" && Cause.hasDies(exit.cause),
        });
      };
      return span;
    },
  });
}

export const TracerLive = Layer.succeed(Tracer.Tracer, requestTraceTracer(Tracer.nativeTracer));
