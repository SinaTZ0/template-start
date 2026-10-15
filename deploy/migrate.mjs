/*===== Database Migrations =====*/
// Applies the pending SQL migrations in `drizzle/` and exits non-zero on failure, so a failed migration stops the
// deployment before the new app starts. Runs in the production image (`compose.prod.yaml`, `migrate` service), which
// has no dev dependencies, TypeScript loader or `~/` alias: plain JavaScript on runtime packages only.
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  // Drizzle records applied migrations in `drizzle.__drizzle_migrations` and runs the pending ones in one transaction.
  await migrate(drizzle({ client: pool }), { migrationsFolder });
  console.log("Database migrations are up to date.");
} finally {
  await pool.end();
}
