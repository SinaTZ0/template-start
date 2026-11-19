import { Layer, ManagedRuntime } from "effect";

import { MediaRepo } from "#/orpc/media/repository";
import { MediaService } from "#/orpc/media/service";
import { NoteRepo } from "#/orpc/note/repository";
import { NoteService } from "#/orpc/note/service";
import { SessionService } from "#/orpc/session/service";
import { Auth } from "#/server/auth.server";
import { Captcha } from "#/server/captcha.server";
import { AppConfig } from "#/server/config.server";
import { Db, PgLive } from "#/server/db.server";
import { Jobs } from "#/server/jobs.server";
import { Mailer } from "#/server/mailer.server";
import { ExportLive } from "#/server/observability/export.server";
import { LoggerLive } from "#/server/observability/logger.server";
import { RequestSpansLive } from "#/server/observability/request-spans.server";
import { Storage } from "#/server/storage.server";

/*===== Layers =====*/
// The app's services, each built once per runtime from its dependencies (docs/backend/architecture.md). A new
// feature adds its repository and service layers here.

/**
 * The infrastructure: configuration, the Postgres pool and what shares it (Drizzle, the job queue), the bucket, the
 * mailbox, and Better-Auth, which queues its emails as jobs.
 */
const PlatformLive = Auth.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(Db.layer, Jobs.layer)),
  Layer.provideMerge(PgLive),
  Layer.provideMerge(Layer.mergeAll(Storage.layer, Mailer.layer, Captcha.layer)),
);

/**
 * Logging, tracing and export (docs/backend/logging.md), built in this order: the app's loggers, then the OTLP exporter
 * (when configured), which adds its logger to them and sets its tracer, then the request collector, which wraps
 * whichever tracer is in place.
 */
const ObservabilityLive = RequestSpansLive.pipe(Layer.provideMerge(ExportLive), Layer.provideMerge(LoggerLive));

/** The features' repositories and services. A service may use another feature's service (`note` uses `media`). */
const FeaturesLive = Layer.mergeAll(NoteService.layer, SessionService.layer).pipe(
  Layer.provideMerge(MediaService.layer),
  Layer.provideMerge(Layer.mergeAll(NoteRepo.layer, MediaRepo.layer)),
);

/**
 * Everything Effect code on the server can require. Logging and tracing wrap it all, layer construction included, and
 * the configuration wraps them.
 */
export const AppLayer = FeaturesLive.pipe(
  Layer.provideMerge(PlatformLive),
  Layer.provideMerge(ObservabilityLive),
  Layer.provideMerge(AppConfig.layer),
);

export type AppServices = Layer.Success<typeof AppLayer>;

export type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, unknown>;

/*===== Runtime =====*/
/**
 * The server's one runtime. It builds `AppLayer` on first use (the pool, the queue's table) and keeps it for the
 * process. Boundaries run Effects on it: the oRPC handler (`#/orpc/effect.server`), the job workers (`src/server.ts`).
 */
export const appRuntime = ManagedRuntime.make(AppLayer);

// In development a changed server module is loaded again, with a new runtime. The one it replaces is disposed, which
// closes its pools: without it, every reload would keep ten more connections open.
const loaded = globalThis as { appRuntime?: AppRuntime };
if (loaded.appRuntime) void loaded.appRuntime.dispose();
loaded.appRuntime = appRuntime;
