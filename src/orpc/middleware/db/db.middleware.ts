import { os } from "@orpc/server";

import { db } from "#/db/client.server";

/*===== Database Middleware =====*/
/**
 * Provides the shared Drizzle client as `context.db`, so procedures pass it to services
 * explicitly instead of services importing the singleton.
 */
export const provideDbMiddleware = os.middleware(async ({ next }) => next({ context: { db } }));
