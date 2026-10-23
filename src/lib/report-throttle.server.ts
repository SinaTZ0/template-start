/*===== Report Throttle =====*/
// Every server-side report reaches the error viewer from one address, and the viewer answers a burst past its limit
// with a `Retry-After` that stops the SDK from sending anything at all for a while. So the app keeps repeats from
// using up that budget itself: during an incident (a slow database makes every request slow) the first reports show
// what happened, and the rest are only counted, leaving room for the errors that differ.

const WINDOW_MS = 60_000;
// Each distinct key holds one entry; a flood of distinct keys evicts the least recently seen instead of growing memory.
const MAX_KEYS = 500;

type ThrottleEntry = { windowStart: number; sent: number; skipped: number };

/**
 * Allows `limit` reports per key in each 60-second window and counts the ones past it.
 *
 * @returns `take(key)`: `undefined` when this report should be skipped, otherwise how many reports with the same key
 * were skipped since the last one sent, to attach to this one.
 */
export function createReportThrottle({ limit }: { limit: number }) {
  const entries = new Map<string, ThrottleEntry>();

  return function take(key: string): number | undefined {
    const now = Date.now();
    let entry = entries.get(key);

    /*------ Recency ------*/
    // Re-inserting moves the key to the end of the Map's order, so the first key is always the least recently seen.
    if (entry) {
      entries.delete(key);
    } else {
      if (entries.size >= MAX_KEYS) entries.delete(entries.keys().next().value!);
      entry = { windowStart: now, sent: 0, skipped: 0 };
    }
    entries.set(key, entry);

    /*------ Window ------*/
    // A new window starts the count again, but keeps the skipped count: it belongs on the next report sent.
    if (now - entry.windowStart >= WINDOW_MS) {
      entry.windowStart = now;
      entry.sent = 0;
    }
    if (entry.sent >= limit) {
      entry.skipped += 1;
      return undefined;
    }
    entry.sent += 1;
    const skipped = entry.skipped;
    entry.skipped = 0;
    return skipped;
  };
}

/*===== Error Key =====*/
// Digits and UUIDs vary between repeats of one error (`note 4182 not found`), so they are left out of its key.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const DIGITS = /\d+/g;
// A V8 stack line: `    at fn (/app/src/lib/x.ts:12:5)` or `    at /app/src/lib/x.ts:12:5`.
const STACK_FRAME = /^\s*at .*?\(?([^\s()]+:\d+:\d+)\)?$/;

/**
 * What makes two errors "the same" for throttling: the error's type, its message without digits and UUIDs, and its
 * first frame in the app's own code (not `node_modules` or Node's internals). Errors thrown from different places are
 * never throttled by each other.
 */
export function errorThrottleKey(err: unknown): string {
  if (!(err instanceof Error)) return `value\u0000${String(err).replace(UUID, "#").replace(DIGITS, "#")}`;

  const message = err.message.replace(UUID, "#").replace(DIGITS, "#");
  const frame = (err.stack ?? "")
    .split("\n")
    .map((line) => STACK_FRAME.exec(line)?.[1])
    .find((location) => location && !location.includes("node_modules") && !location.startsWith("node:"));
  return `${err.name}\u0000${message}\u0000${frame ?? ""}`;
}
