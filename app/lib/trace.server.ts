import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

/*===== Types =====*/
/** What a span measured. Kinds nest: a loader's time includes the procedures and queries it ran. */
export type SpanKind =
  "middleware" | "loader" | "action" | "procedure" | "service" | "repository" | "db" | "storage" | "task";

type Span = {
  id: number;
  parent: number | undefined;
  kind: SpanKind;
  name: string;
  at: number;
  ms: number;
  failed: boolean;
};

/** The timings collected while one request is handled. */
export type RequestTrace = {
  /**
   * The ID the logger adds to every line written during the request, so one request's lines can be grouped, and that
   * the response returns as `X-Request-Id`. 16 hex characters (64 bits), so it stays unique across months of logs. Not
   * a UUID: the error viewer tells it from an `errorId` (a UUID) by its shape.
   */
  id: string;
  /**
   * The request line, without the query string (it can carry tokens), and the browser's client ID
   * (`app/lib/client-id.ts`) when it sent one. Error reports carry them.
   */
  request?: { method: string; path: string; clientId?: string };
  /** The signed-in user's database ID, once the request's session is read (`setTraceUser`). Never the email or name. */
  userId?: string;
  start: number;
  spans: Span[];
  totals: Partial<Record<SpanKind, { count: number; ms: number }>>;
  nextSpanId: number;
};

/*===== Request Scope =====*/
// AsyncLocalStorage follows the request through every `await`, so deep code (a query, an S3 call) finds the trace of
// the request it serves without anything being passed down. A second store holds the span the code runs inside, so
// each span knows its parent even when loaders run in parallel and their times overlap.
const storage = new AsyncLocalStorage<RequestTrace>();
const parentStorage = new AsyncLocalStorage<number>();

// A loop of queries would otherwise grow one trace without bound. Past this, spans still count towards the totals.
const MAX_SPANS = 300;

/** Runs `fn` with a fresh trace that every span recorded inside it lands in. */
export function runWithTrace<T>(request: RequestTrace["request"], fn: (trace: RequestTrace) => T): T {
  const trace: RequestTrace = {
    id: randomBytes(8).toString("hex"),
    request,
    start: performance.now(),
    spans: [],
    totals: {},
    nextSpanId: 1,
  };
  // A fresh parent scope too: a request started from inside another one's span must not nest under it.
  return storage.run(trace, () => parentStorage.run(0, () => fn(trace)));
}

/** The trace of the request being handled, or `undefined` outside one (startup, scripts, tests). */
export function currentTrace(): RequestTrace | undefined {
  return storage.getStore();
}

/**
 * Records who the current request is from, so its later log lines and error reports carry the user's ID. Called where
 * the session is read (`getRequestSession` in `app/lib/auth.server.ts`). Outside a request it does nothing.
 */
export function setTraceUser(userId: string) {
  const trace = currentTrace();
  if (trace) trace.userId = userId;
}

/** The span the calling code runs inside. Read it when the work starts, for a span recorded later (`recordSpan`). */
export function currentSpanId(): number | undefined {
  return parentStorage.getStore() || undefined;
}

/*===== Spans =====*/
/**
 * Records a finished span that started at `start` (a `performance.now()` value). For work that can't be wrapped in
 * `span`, e.g. a callback-based driver. Such a span has no children.
 *
 * @param trace Defaults to the current one. Pass it when the work finishes outside the request's async context.
 * @param parent Defaults to the current span. Pass `currentSpanId()` as read when the work started, for the same reason.
 * @returns How long the span took, in milliseconds, even when there is no trace to record it in.
 */
export function recordSpan({
  trace = currentTrace(),
  parent = currentSpanId(),
  id,
  kind,
  name,
  start,
  failed,
}: {
  trace?: RequestTrace;
  parent?: number;
  /** Set by `span`, which hands its ID to the children before the span is recorded. */
  id?: number;
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
  if (trace.spans.length < MAX_SPANS) {
    trace.spans.push({ id: id ?? trace.nextSpanId++, parent, kind, name, at: start - trace.start, ms, failed });
  }
  return ms;
}

/**
 * Times `fn` as one span of the current request: `await span({ kind: "task", name: "media.processImage" }, () => ...)`.
 * Spans started inside `fn` become its children. Use it around anything that may be slow and isn't already traced
 * (loaders, actions, procedures, services, repositories, queries and S3 calls are).
 *
 * @param isFailure For work that reports failure in its result instead of throwing (React Router's instrumentation).
 */
export async function span<T>(
  { kind, name, isFailure }: { kind: SpanKind; name: string; isFailure?: (result: T) => boolean },
  fn: () => Promise<T>,
): Promise<T> {
  const trace = currentTrace();
  if (!trace) return fn();

  const id = trace.nextSpanId++;
  const parent = currentSpanId();
  const start = performance.now();
  let failed = true;
  try {
    const result = await parentStorage.run(id, fn);
    failed = isFailure?.(result) ?? false;
    return result;
  } finally {
    recordSpan({ trace, parent, id, kind, name, start, failed });
  }
}

/**
 * Wraps an async function so every call is a span named `name`. The `traceLayers` Vite plugin
 * (`vite-plugins/trace-layers.ts`) applies it to the async exports of every `service.ts` and `repository.ts` under
 * `app/orpc/`; app code doesn't call it.
 */
export function traced<Args extends unknown[], Result>({
  kind,
  name,
  fn,
}: {
  kind: SpanKind;
  name: string;
  fn: (...args: Args) => Promise<Result>;
}): (...args: Args) => Promise<Result> {
  return (...args) => span({ kind, name }, () => fn(...args));
}

/*===== Summaries =====*/
/** Count and total time per kind, e.g. `{ db: { count: 3, ms: 12 } }`, rounded to whole milliseconds. */
export function traceTotals(trace: RequestTrace): Partial<Record<SpanKind, { count: number; ms: number }>> {
  return Object.fromEntries(
    Object.entries(trace.totals).map(([kind, total]) => [kind, { count: total.count, ms: Math.round(total.ms) }]),
  );
}

/*------ Timeline ------*/
// Spans shorter than this share of the request are left out (their count is shown), so the tree shows where the time
// went rather than every 1 ms query.
const MIN_SHARE = 0.02;
const MAX_ROWS = 40;

/** One timeline row: a span, or identical siblings merged into one (`count` > 1). Times are whole milliseconds. */
export type TimelineRow = {
  /** 0 for a top-level span, 1 for a span inside it, and so on. */
  depth: number;
  kind: SpanKind;
  name: string;
  count: number;
  /** When it started, counted from the start of the request. */
  at: number;
  ms: number;
  failed: boolean;
};

/** The request's spans as the error viewer draws them: a tree in the order they started, flattened into rows. */
export type Timeline = {
  /** The request's time when the timeline was taken: the scale the rows are drawn against. */
  ms: number;
  rows: TimelineRow[];
  /** How many spans were left out, for being shorter than `hiddenUnderMs` or past the row limit. */
  hidden: number;
  hiddenUnderMs: number;
};

/** Sibling spans of the same kind and name, merged into one row: `db ×41`. */
type SpanGroup = {
  kind: SpanKind;
  name: string;
  at: number;
  ms: number;
  count: number;
  failed: boolean;
  ids: number[];
};

function groupSiblings(spans: Span[]): SpanGroup[] {
  const groups = new Map<string, SpanGroup>();
  for (const { id, kind, name, at, ms, failed } of spans.toSorted((a, b) => a.at - b.at)) {
    const key = `${kind}\u0000${name}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      group.ms += ms;
      group.failed ||= failed;
      group.ids.push(id);
    } else {
      groups.set(key, { kind, name, at, ms, count: 1, failed, ids: [id] });
    }
  }
  return [...groups.values()];
}

/**
 * The request's spans as a tree in the order they started, each row after the span it ran inside. Identical siblings
 * are merged (`db ×41`, the sign of a query in a loop), and spans under 2% of the request are left out. Time a parent
 * has beyond its children is its own work (rendering, CPU, waiting).
 */
export function traceTimeline(trace: RequestTrace): Timeline {
  const total = performance.now() - trace.start;
  const minMs = total * MIN_SHARE;

  /*------ Tree ------*/
  const recorded = new Set(trace.spans.map(({ id }) => id));
  const children = new Map<number | undefined, Span[]>();
  for (const entry of trace.spans) {
    // A parent past `MAX_SPANS` was never recorded; its children move to the top level.
    const parent = entry.parent !== undefined && recorded.has(entry.parent) ? entry.parent : undefined;
    children.set(parent, [...(children.get(parent) ?? []), entry]);
  }

  /** The spans `ids` and everything under them. */
  const countSpans = (ids: number[]): number =>
    ids.reduce((sum, id) => sum + 1 + countSpans((children.get(id) ?? []).map((child) => child.id)), 0);

  /*------ Rows ------*/
  const rows: TimelineRow[] = [];
  let hidden = 0;
  const visit = (parents: (number | undefined)[], depth: number) => {
    const spans = parents.flatMap((parent) => children.get(parent) ?? []);
    for (const group of groupSiblings(spans)) {
      if (group.ms < minMs || rows.length >= MAX_ROWS) {
        hidden += countSpans(group.ids);
        continue;
      }
      const { kind, name, count, failed } = group;
      rows.push({ depth, kind, name, count, at: Math.round(group.at), ms: Math.round(group.ms), failed });
      visit(group.ids, depth + 1);
    }
  };
  visit([undefined], 0);

  return { ms: Math.round(total), rows, hidden, hiddenUnderMs: Math.round(minMs) };
}
