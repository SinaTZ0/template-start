/*===== Span Kinds =====*/
/**
 * What a span measured, for the request line's totals and the timeline's colours. Kinds nest: a procedure's time
 * includes the services and queries it ran.
 */
export type SpanKind = "http" | "procedure" | "service" | "repository" | "db" | "storage" | "task";

const REPOSITORY = /^[A-Za-z]+Repo\./;
const SERVICE = /^[A-Za-z]+Service\./;
const STORAGE = /^Storage\./;
const PROCEDURE = /^rpc\./;

/**
 * A span's kind, from its name (which `Effect.fn("Owner.method")` sets) or its SQL. The naming convention is the
 * contract: `NoteService.list` is a service, `NoteRepo.findOwned` a repository, `rpc.note.list` a procedure. A
 * request's root span is `http`, which the collector knows by its place, not its name.
 */
export function spanKind({ name, sql }: { name: string; sql: string | undefined }): SpanKind {
  if (sql !== undefined) return "db";
  if (REPOSITORY.test(name)) return "repository";
  if (SERVICE.test(name)) return "service";
  if (STORAGE.test(name)) return "storage";
  if (PROCEDURE.test(name)) return "procedure";
  return "task";
}

/*===== Spans =====*/
/** A finished span of a request, as the collector keeps it (`#/server/observability/request-spans.server`). */
export type CollectedSpan = {
  id: string;
  parent: string | undefined;
  kind: SpanKind;
  name: string;
  /** When it started, in milliseconds from the start of the request. */
  at: number;
  ms: number;
  failed: boolean;
};

/*===== Timeline =====*/
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
  ids: string[];
};

function groupSiblings(spans: CollectedSpan[]): SpanGroup[] {
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
 * has beyond its children is its own work (rendering, CPU, waiting). The root `http` span is the request itself, so
 * its children are the top level.
 *
 * @param totalMs The request's time, the scale the rows are drawn against.
 */
export function buildTimeline({ spans, totalMs }: { spans: CollectedSpan[]; totalMs: number }): Timeline {
  const minMs = totalMs * MIN_SHARE;

  /*------ Tree ------*/
  const roots = new Set(spans.filter((span) => span.kind === "http").map((span) => span.id));
  const recorded = new Set(spans.map(({ id }) => id));
  const children = new Map<string | undefined, CollectedSpan[]>();
  for (const entry of spans) {
    if (roots.has(entry.id)) continue;
    // A parent past the span cap was never recorded, and the request's own span is the timeline itself: their
    // children move to the top level.
    const parent =
      entry.parent !== undefined && recorded.has(entry.parent) && !roots.has(entry.parent) ? entry.parent : undefined;
    children.set(parent, [...(children.get(parent) ?? []), entry]);
  }

  /** The spans `ids` and everything under them. */
  const countSpans = (ids: string[]): number =>
    ids.reduce((sum, id) => sum + 1 + countSpans((children.get(id) ?? []).map((child) => child.id)), 0);

  /*------ Rows ------*/
  const rows: TimelineRow[] = [];
  let hidden = 0;
  const visit = (parents: (string | undefined)[], depth: number) => {
    const level = parents.flatMap((parent) => children.get(parent) ?? []);
    for (const group of groupSiblings(level)) {
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

  return { ms: Math.round(totalMs), rows, hidden, hiddenUnderMs: Math.round(minMs) };
}
