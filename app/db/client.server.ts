import { drizzle } from "drizzle-orm/node-postgres";

import { env } from "~/env.server";
import * as schema from "~/db/schema";

/*===== Client =====*/
/**
 * Shared Drizzle client backed by a node-postgres connection pool.
 *
 * Server-only: create one per process and pass it to repositories through their
 * dependency object rather than importing it there directly.
 */
export const db = drizzle({
  connection: env.DATABASE_URL,
  schema,
});

export type Database = typeof db;
