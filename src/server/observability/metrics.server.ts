import { monitorEventLoopDelay, performance } from "node:perf_hooks";

import { Effect, Layer, Metric, Schedule } from "effect";

/*===== Metrics =====*/
// Counted always, exported only when OTLP is configured (`OTEL_EXPORTER_OTLP_ENDPOINT`). Names, units and attributes
// follow OpenTelemetry's semantic conventions where one exists, so a backend's ready-made dashboards read them.
// Attributes are low-cardinality on purpose: route patterns (`/notes/$noteId`), never paths or IDs.

/** Durations are in seconds, as the conventions have them. The exporter reads the unit from this attribute. */
const SECONDS = { unit: "seconds" };
const BYTES = { unit: "bytes" };

/** The conventions' buckets for a request's duration: 5 ms to 10 s. */
const DURATION_BOUNDARIES = Metric.boundariesFromIterable([
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
]);

/*------ Requests ------*/
/**
 * Every request's time to its response, by `http.request.method`, `http.route` (the route pattern) and
 * `http.response.status_code`.
 */
export const requestDuration = Metric.histogram("http.server.request.duration", {
  description: "Duration of HTTP server requests",
  boundaries: DURATION_BOUNDARIES,
  attributes: SECONDS,
});

/*------ Database ------*/
/** Every statement on the app's pool, by `db.system.name` and `db.operation.name` (`SELECT`, `INSERT`…). */
export const dbOperationDuration = Metric.histogram("db.client.operation.duration", {
  description: "Duration of database client operations",
  boundaries: Metric.boundariesFromIterable([0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10]),
  attributes: SECONDS,
});

/*------ Jobs ------*/
/** Every job run, by `job.name` and `job.outcome` (`success`, `retry`, `failed`). Its count is the number of runs. */
export const jobRunDuration = Metric.histogram("job.run.duration", {
  description: "Duration of background job runs",
  boundaries: Metric.boundariesFromIterable([0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 300]),
  attributes: SECONDS,
});

/*------ Process ------*/
const memoryUsage = Metric.gauge("process.memory.usage", {
  description: "Physical memory in use (resident set size)",
  attributes: BYTES,
});
const heapUsed = Metric.gauge("v8js.memory.heap.used", { description: "Heap memory in use", attributes: BYTES });
// The sampler's own interval is part of every reading: an idle loop reads about 0.01.
const EVENT_LOOP_RESOLUTION_MS = 10;
const eventLoopDelay = Metric.gauge("nodejs.eventloop.delay.p99", {
  description: "99th percentile of the event loop's delay since the last sample",
  attributes: SECONDS,
});
const eventLoopUtilization = Metric.gauge("nodejs.eventloop.utilization", {
  description: "Share of time the event loop was busy since the last sample",
});

/** How often the process is sampled: the exporter's own interval, so each export carries a fresh value. */
const SAMPLE_INTERVAL = "10 seconds";

/**
 * Samples the process for as long as the runtime lives: memory (the first thing to watch on a small server), and the
 * event loop's delay and utilization, which rise when CPU work (image processing, rendering) holds up every request.
 */
export const ProcessMetricsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const delay = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const histogram = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
        histogram.enable();
        return histogram;
      }),
      (histogram) => Effect.sync(() => histogram.disable()),
    );
    let utilization = performance.eventLoopUtilization();

    const sample = Effect.gen(function* () {
      const memory = process.memoryUsage();
      yield* Metric.update(memoryUsage, memory.rss);
      yield* Metric.update(heapUsed, memory.heapUsed);
      // The histogram counts nanoseconds.
      yield* Metric.update(eventLoopDelay, delay.percentile(99) / 1e9);
      delay.reset();
      const current = performance.eventLoopUtilization();
      yield* Metric.update(eventLoopUtilization, performance.eventLoopUtilization(current, utilization).utilization);
      utilization = current;
    });

    yield* sample.pipe(Effect.repeat(Schedule.spaced(SAMPLE_INTERVAL)), Effect.forkScoped);
  }),
);
