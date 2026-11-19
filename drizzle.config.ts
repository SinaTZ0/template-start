import { defineConfig } from "drizzle-kit";

import "./src/server/load-env.server";

/*===== Drizzle Kit Config =====*/
// Reads `DATABASE_URL` the way the app does (`.env` in development, the environment elsewhere).
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL (see .env.example) to run drizzle-kit.");
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url,
  },
  verbose: true,
});
