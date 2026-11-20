import { Layer, ManagedRuntime } from "effect";
import type { Effect } from "effect";

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
import { joinRequest } from "#/server/observability/request-scope.server";
import { RequestSpansLive } from "#/server/observability/request-spans.server";
import { Storage } from "#/server/storage.server";

/*===== Layers =====*/
// The app's services, each built once per runtime from its dependencies (docs/backend/architecture.md). A new
// feature adds its repository and service layers here.

/**
 * The services that reach outside the process. A test replaces one with its test layer (`Auth.layerTest`,
 * `Storage.layerMemory`, `Mailer.layerMemory`).
 */
type OutsideServices = {
  readonly auth?: typeof Auth.layer;
  readonly storage?: typeof Storage.layer;
  readonly mailer?: typeof Mailer.layer;
};

/**
 * Logging, tracing and export (docs/backend/logging.md), built in this order: the app's logger, then the OTLP exporter
 * (when configured), which sets its tracer, then the request collector, which wraps whichever tracer is in place.
 */
const ObservabilityLive = RequestSpansLive.pipe(Layer.provideMerge(ExportLive), Layer.provideMerge(LoggerLive));

/** The features' repositories and services. A service may use another feature's service (`note` uses `media`). */
const FeaturesLive = Layer.mergeAll(NoteService.layer, SessionService.layer).pipe(
  Layer.provideMerge(MediaService.layer),
  Layer.provideMerge(Layer.mergeAll(NoteRepo.layer, MediaRepo.layer)),
);

/**
 * Builds the app's layer: everything Effect code on the server can require. Logging and tracing wrap it all, layer
 * construction included, and the configuration wraps them.
 *
 * A test passes the services it replaces. They have to go in here, not be merged over the finished layer: a service
 * takes its dependencies when its layer is built (`SessionService` keeps the `Auth` it was built with), so a layer
 * merged on afterwards reaches only code that asks for the service at call time, and the real one is still built.
 */
export function makeAppLayer({
  auth = Auth.layer,
  storage = Storage.layer,
  mailer = Mailer.layer,
}: OutsideServices = {}) {
  // The infrastructure: the Postgres pool and what shares it (Drizzle, the job queue), the bucket, the mailbox, and
  // Better-Auth, which queues its emails as jobs.
  const PlatformLive = auth.pipe(
    Layer.provideMerge(Layer.mergeAll(Db.layer, Jobs.layer)),
    Layer.provideMerge(PgLive),
    Layer.provideMerge(Layer.mergeAll(storage, mailer, Captcha.layer)),
  );
  return FeaturesLive.pipe(
    Layer.provideMerge(PlatformLive),
    Layer.provideMerge(ObservabilityLive),
    Layer.provideMerge(AppConfig.layer),
  );
}

/** The app's layer as the server runs it. */
export const AppLayer = makeAppLayer();

export type AppServices = Layer.Success<typeof AppLayer>;

export type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, unknown>;

/*===== Runtime =====*/
/**
 * The server's one runtime. It builds `AppLayer` on first use (the pool, the queue's table) and keeps it for the
 * process. Boundaries run Effects on it: the oRPC handler (`#/orpc/effect.server`), the job workers (`src/server.ts`),
 * and the server routes outside oRPC (`runInRequest`).
 */
export const appRuntime = ManagedRuntime.make(AppLayer);

/**
 * Runs an Effect for the request being handled, as part of its trace (`joinRequest`). This is how a server route
 * outside oRPC (`/healthz`, `/api/auth/*`, `/robots.txt`) runs one; a procedure's Effect is run by `effectProcedure`.
 *
 * A failure rejects the promise, and Start answers the request with a 500. The route handles what it expects
 * (`/healthz` turns an unreachable database into a 503).
 */
export function runInRequest<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  return appRuntime.runPromise(joinRequest(effect));
}

// In development a changed server module is loaded again, with a new runtime. The one it replaces is disposed, which
// closes its pools: without it, every reload would keep ten more connections open.
const loaded = globalThis as { appRuntime?: AppRuntime };
if (loaded.appRuntime) void loaded.appRuntime.dispose();
loaded.appRuntime = appRuntime;
