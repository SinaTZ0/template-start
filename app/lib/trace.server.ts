import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

/*===== Types =====*/
/** What a span measured. Kinds nest: a loader's time includes the procedures and queries it ran. */
export type SpanKind = "middleware" | "loader" | "action" | "procedure" | "db" | "storage" | "task";

type Span = { kind: SpanKind; name: string; at: number; ms: number; failed: boolean };

/** The timings collected while one request is handled. */
export type RequestTrace = {
  /** Short ID the logger adds to every line written during the request, so one request's lines can be grouped. */
  id: string;
  start: number;
  spans: Span[];
  totals: Partial<Record<SpanKind, { count: number; ms: number }>>;
};

/*===== Request Scope =====*/
// AsyncLocalStorage follows the request through every `await`, so deep code (a query, an S3 call) finds the trace of
// the request it serves without anything being passed down.
const storage = new AsyncLocalStorage<RequestTrace>();

// A loop of queries would otherwise grow one trace without bound. Past this, spans still count towards the totals.
const MAX_SPANS = 300;

/** Runs `fn` with a fresh trace that every span recorded inside it lands in. */
export function runWithTrace<T>(fn: (trace: RequestTrace) => T): T {
  const trace: RequestTrace = { id: randomUUID().slice(0, 8), start: performance.now(), spans: [], totals: {} };
  return storage.run(trace, () => fn(trace));
}

/** The trace of the request being handled, or `undefined` outside one (startup, scripts, tests). */
export function currentTrace(): RequestTrace | undefined {
  return storage.getStore();
}

/*===== Spans =====*/
/**
 * Records a finished span that started at `start` (a `performance.now()` value). For work that can't be wrapped in
 * `span`, e.g. a callback-based driver.
 *
 * @param trace Defaults to the current one. Pass it when the work finishes outside the request's async context.
 * @returns How long the span took, in milliseconds, even when there is no trace to record it in.
 */
export function recordSpan({
  trace = currentTrace(),
  kind,
  name,
  start,
  failed,
}: {
  trace?: RequestTrace;
  kind: SpanKind;
  name: string;
  start: number;
  failed: boolean;
}): number {
  const ms = performance.now() - start;
  if (!trace) return ms;

  const total = (trace.totals[kind] ??= { count: 0, ms: 0 });
  total.count += 1;
  total.ms += ms;
  if (trace.spans.length < MAX_SPANS) trace.spans.push({ kind, name, at: start - trace.start, ms, failed });
  return ms;
}

/**
 * Times `fn` as one span of the current request: `await span({ kind: "task", name: "media.processImage" }, () => ...)`.
 * Use it around anything that may be slow and isn't already traced (loaders, actions, procedures, queries and S3 calls
 * are).
 */
export async function span<T>({ kind, name }: { kind: SpanKind; name: string }, fn: () => Promise<T>): Promise<T> {
  const trace = currentTrace();
  if (!trace) return fn();

  const start = performance.now();
  let failed = true;
  try {
    const result = await fn();
    failed = false;
    return result;
  } finally {
    recordSpan({ trace, kind, name, start, failed });
  }
}

/*===== Summaries =====*/
/** Count and total time per kind, e.g. `{ db: { count: 3, ms: 12 } }`, rounded to whole milliseconds. */
export function traceTotals(trace: RequestTrace): Partial<Record<SpanKind, { count: number; ms: number }>> {
  return Object.fromEntries(
    Object.entries(trace.totals).map(([kind, total]) => [kind, { count: total.count, ms: Math.round(total.ms) }]),
  );
}

/**
 * The slowest spans, back in the order they started, one readable line each:
 * `  340ms  at +12ms  db  select "note"."id" ...`. Gaps between them are time no span covers (rendering, CPU work).
 */
export function traceTimeline(trace: RequestTrace, limit = 15): string[] {
  return trace.spans
    .toSorted((a, b) => b.ms - a.ms)
    .slice(0, limit)
    .toSorted((a, b) => a.at - b.at)
    .map(({ kind, name, at, ms, failed }) => {
      const took = `${Math.round(ms)}ms`.padStart(7);
      const offset = `+${Math.round(at)}ms`.padEnd(8);
      return `${took}  at ${offset} ${kind.padEnd(10)} ${name}${failed ? "  (failed)" : ""}`;
    });
}
