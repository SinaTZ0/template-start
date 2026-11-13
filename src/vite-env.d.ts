/** Variables Vite exposes to client code through `envPrefix` (`vite.config.ts`). */
interface ImportMetaEnv {
  readonly SENTRY_DSN?: string;
  /** The commit the build was made from; empty in development. */
  readonly APP_RELEASE?: string;
}
