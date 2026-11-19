import { Metric } from "effect";

/*===== Metrics =====*/
// Counted always, exported only when OTLP is configured (`OTEL_EXPORTER_OTLP_ENDPOINT`). Attributes are low-cardinality
// on purpose: route patterns (`/notes/$noteId`), never paths or IDs.

/** Every request's time to its response, by method, route pattern and status class (`2xx`, `4xx`, `5xx`). */
export const requestDuration = Metric.histogram("http.server.request.duration", {
  description: "Time to the response's start, in milliseconds",
  boundaries: Metric.exponentialBoundaries({ start: 5, factor: 2, count: 12 }),
});

/** Every job run, by job and outcome (`success`, `retry`, `failed`). */
export const jobRuns = Metric.counter("jobs.runs", { description: "Background job runs" });
