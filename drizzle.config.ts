import { defineConfig } from "drizzle-kit";

import { env } from "./app/env.server";

/*===== Drizzle Kit Config =====*/
// Reuses the validated server env so CLI commands fail with the same clear error as the app
// when DATABASE_URL is missing or malformed.
export default defineConfig({
  dialect: "postgresql",
  schema: "./app/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
