import path from "node:path";

import pino from "pino";
import type { PrettyOptions } from "pino-pretty";

import { env } from "~/env.server";
import { currentTrace } from "~/lib/trace.server";

/*===== Error Serializer =====*/
// A raw stack is mostly framework frames (React Router, oRPC, Vite, node internals) that say nothing about where the
// app went wrong. Only the app's own frames are kept, with paths relative to the project.
const MAX_FRAMES = 6;
const MAX_CAUSE_FRAMES = 3;
const MAX_CAUSE_DEPTH = 3;
const MAX_TEXT = 1000;
const MAX_PROP_JSON = 500;

// `cause` and `stack` are handled on their own. Postgres errors carry the C file and routine that raised them, which
// only matter to Postgres developers. Drizzle copies the query and its parameters onto its errors: the query is
// already in the message, and the parameters can hold personal data.
const OMITTED_PROPS = new Set([
  "stack",
  "message",
  "cause",
  "name",
  "position",
  "file",
  "line",
  "routine",
  "severity",
  "length",
  "query",
  "params",
]);

const projectRoot = process.cwd() + path.sep;

function isFrameworkFrame(frame: string): boolean {
  return /node_modules|\(node:|at node:|\(<anonymous>\)|\(index \d+\)/.test(frame);
}

function truncate(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}… (${text.length - MAX_TEXT} more chars)` : text;
}

/** Drizzle's "Failed query" messages end with the query's parameters, which can hold personal data. */
function hideQueryParams(text: string): string {
  return text.replace(/\nparams: [\s\S]*$/, "\nparams: (hidden)");
}

/**
 * Keeps the stack's header and its first app frames. A stack with no app frame (an error raised inside a library on a
 * callback) keeps its top frames instead, so it still points somewhere.
 */
function trimStack(stack: string, maxFrames: number): string {
  const lines = stack.split("\n");
  const firstFrame = lines.findIndex((line) => /^\s+at /.test(line));
  if (firstFrame === -1) return truncate(stack);

  const header = truncate(hideQueryParams(lines.slice(0, firstFrame).join("\n")));
  const frames = lines.slice(firstFrame);
  const appFrames = frames.filter((frame) => !isFrameworkFrame(frame));
  const kept = (appFrames.length > 0 ? appFrames : frames)
    .slice(0, maxFrames)
    .map((frame) => frame.replace("file://", "").replaceAll(projectRoot, ""));
  const hidden = frames.length - kept.length;

  return [header, ...kept, ...(hidden > 0 ? [`    … ${hidden} framework frames hidden`] : [])].join("\n");
}

/** A property worth logging: a primitive, or an object small enough not to flood the line (e.g. oRPC's `data`). */
function isSmallValue(value: unknown): boolean {
  if (value === null || ["number", "boolean"].includes(typeof value)) return true;
  if (typeof value === "string") return value.length <= MAX_PROP_JSON;
  if (typeof value !== "object") return false;
  try {
    return JSON.stringify(value).length <= MAX_PROP_JSON;
  } catch {
    return false;
  }
}

/** Serializes an error and its cause chain with trimmed stacks. Non-errors pass through unchanged. */
function serializeError(value: unknown, depth = 0): unknown {
  if (!(value instanceof Error)) return value;

  const result: Record<string, unknown> = { type: value.name, message: truncate(hideQueryParams(value.message)) };
  for (const [key, prop] of Object.entries(value)) {
    if (!OMITTED_PROPS.has(key) && isSmallValue(prop)) result[key] = prop;
  }
  if (value.stack) result.stack = trimStack(value.stack, depth === 0 ? MAX_FRAMES : MAX_CAUSE_FRAMES);
  if (value.cause !== undefined) {
    result.cause = depth < MAX_CAUSE_DEPTH ? serializeError(value.cause, depth + 1) : "(deeper causes hidden)";
  }
  return result;
}

/*===== Development Output =====*/
type RequestFields = { method: string; path: string; status: number; ms: number };
type TimingFields = Record<string, { count: number; ms: number }>;

/**
 * One line per log in development: `[reqId] module: message`. Request summaries read as
 * `GET /notes 200 45ms (loader 1×30ms, db 2×5ms)`; their slowest spans follow on their own lines when the request
 * was slow.
 */
const formatMessage: PrettyOptions["messageFormat"] = (log, messageKey) => {
  const request = log.request as RequestFields | undefined;
  const timing = log.timing as TimingFields | undefined;
  let message = String(log[messageKey] ?? "");

  if (request) {
    const breakdown = Object.entries(timing ?? {})
      .map(([kind, { count, ms }]) => `${kind} ${count}×${ms}ms`)
      .join(", ");
    const summary = `${request.method} ${request.path} ${request.status} ${request.ms}ms${breakdown ? ` (${breakdown})` : ""}`;
    message = message === "request" ? summary : `${message}: ${summary}`;
  }

  const prefix = [log.reqId && `[${String(log.reqId)}]`, log.module && `${String(log.module)}:`].filter(Boolean);
  return [...prefix, message].join(" ");
};

// Development pretty-prints through `pino-pretty` as an in-process stream. pino's `transport` option would run it in a
// worker thread, which can't resolve the module under Vite's dev server (and couldn't take `formatMessage`). It is a
// dev dependency, so it is imported only in development; production writes one JSON object per line to stdout for the
// platform to collect.
const prettyStream =
  env.NODE_ENV === "development"
    ? (await import("pino-pretty")).default({
        ignore: "pid,hostname,reqId,module,request,route,timing",
        messageFormat: formatMessage,
      })
    : undefined;

/*===== Logger =====*/
/**
 * The server's one logger.
 *
 * Log errors under the `err` key so pino serializes their (trimmed) stack and cause:
 * `log.error({ err, errorId }, "message")`. Lines written while a request is handled carry its `reqId`.
 */
export const logger = pino(
  {
    level: env.LOG_LEVEL,
    serializers: { err: serializeError },
    mixin: () => {
      const id = currentTrace()?.id;
      return id ? { reqId: id } : {};
    },
  },
  prettyStream,
);

/** A child logger that tags every line with the module it came from, e.g. `createLogger("media")`. */
export function createLogger(module: string) {
  return logger.child({ module });
}
