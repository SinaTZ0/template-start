import { env } from "#/env.server";
import { createLogger } from "#/lib/logger.server";
import { m } from "#/paraglide/messages";

const log = createLogger("rate-limit");

/*===== Policies =====*/
/** How many requests one client may make per window. `name` keeps each policy's counters apart. */
export type RateLimitPolicy = { name: string; limit: number; windowMs: number };

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** The line shown to a person who hit a limit, in the request's locale. A function: a constant would freeze one locale. */
export function rateLimitedMessage(): string {
  return m.common_rate_limited();
}

/*===== Store =====*/
/**
 * Counts hits per key in fixed windows. The memory store fits one app process, which is what `compose.prod.yaml` runs.
 * Several instances need a shared store (a Postgres table or Redis) behind this same interface, or each would allow
 * the full limit.
 */
export type RateLimitStore = {
  /** Counts one hit and returns the window's total so far and when the window ends. */
  hit(input: { key: string; windowMs: number; now: number }): { count: number; resetAt: number };
};

export function createMemoryStore(): RateLimitStore {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = 0;

  return {
    hit({ key, windowMs, now }) {
      // Expired windows are dropped at most once a minute, so the map doesn't keep every address it has ever seen.
      if (now >= nextSweep) {
        for (const [k, window] of windows) if (window.resetAt <= now) windows.delete(k);
        nextSweep = now + 60_000;
      }

      const current = windows.get(key);
      if (!current || current.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return { count: 1, resetAt: now + windowMs };
      }
      current.count += 1;
      return { ...current };
    },
  };
}

const defaultStore = createMemoryStore();

/*===== Check =====*/
/** Counts one request from `client` against `policy`. */
export function checkRateLimit({
  policy,
  client,
  store = defaultStore,
  now = Date.now(),
}: {
  policy: RateLimitPolicy;
  client: string;
  store?: RateLimitStore;
  now?: number;
}): RateLimitResult {
  const { count, resetAt } = store.hit({ key: `${policy.name}:${client}`, windowMs: policy.windowMs, now });
  if (count <= policy.limit) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
}

/**
 * Counts one request against `policy`, keyed by the client's address.
 *
 * A production request without an address is let through rather than counted in one shared bucket: a proxy mistake
 * would otherwise lock the whole site out at once. The monitor below reports it instead.
 */
export function limitRequest({ headers, policy }: { headers: Headers; policy: RateLimitPolicy }): RateLimitResult {
  const client = clientAddress(headers);
  if (!client) return { allowed: true };
  return checkRateLimit({ policy, client });
}

/*===== Client Address =====*/
// Caddy sets this to the connecting address (`deploy/Caddyfile`), replacing any value the client sent. It can be trusted
// only because the app publishes no port: in production every request arrives through Caddy.
export const CLIENT_ADDRESS_HEADER = "x-real-ip";

/** The client's address, or `null` in production when the proxy didn't send one. */
export function clientAddress(headers: Headers): string | null {
  const address = headers.get(CLIENT_ADDRESS_HEADER)?.trim();
  if (address) {
    noteAddressSeen(Date.now());
    return address;
  }
  // Development and tests have no proxy in front. One shared key keeps the limits working, and testable, locally.
  if (env.NODE_ENV !== "production") return "local";
  noteAddressMissing(Date.now());
  return null;
}

/*===== Missing Address Monitor =====*/
// Logs changes of state instead of every request, so a broken proxy can't flood the log:
// - the first request without an address: an error, which also goes to the error viewer;
// - while addresses stay missing: a warning every 5 minutes with the number of requests affected;
// - the first request with an address again: an info line, so one request through the fixed proxy confirms the fix.
// Errors are at most one per 5 minutes even if addresses keep coming and going.
const REMINDER_MS = 5 * 60_000;

let missing: { since: number; total: number; unreported: number; reportedAt: number | null } | null = null;
let lastErrorAt = Number.NEGATIVE_INFINITY;

function noteAddressMissing(now: number) {
  missing ??= { since: now, total: 0, unreported: 0, reportedAt: null };
  missing.total += 1;
  missing.unreported += 1;

  /*------ First Report ------*/
  if (missing.reportedAt === null) {
    if (now - lastErrorAt < REMINDER_MS) return;
    log.error(
      { err: new Error(`Request without the ${CLIENT_ADDRESS_HEADER} header`), header: CLIENT_ADDRESS_HEADER },
      "client address missing: rate limiting is off for these requests. Check the proxy sets it (deploy/Caddyfile)",
    );
    lastErrorAt = now;
    missing.reportedAt = now;
    missing.unreported = 0;
    return;
  }

  /*------ Reminder ------*/
  if (now - missing.reportedAt >= REMINDER_MS) {
    log.warn(
      { requests: missing.unreported, header: CLIENT_ADDRESS_HEADER },
      "client address still missing: rate limiting is off for these requests",
    );
    missing.reportedAt = now;
    missing.unreported = 0;
  }
}

function noteAddressSeen(now: number) {
  if (!missing) return;
  if (missing.reportedAt !== null) {
    log.info(
      { requests: missing.total, missingForMs: now - missing.since },
      "client address visible again: rate limiting is back on",
    );
  }
  missing = null;
}
