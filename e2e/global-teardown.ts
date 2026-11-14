import { Client } from "pg";

import { E2E_EMAIL_DOMAIN } from "./accounts";

/*===== Global Teardown =====*/
/**
 * Deletes the accounts the tests signed up (their sessions and notes go with them), so repeated runs don't fill the
 * development database. Only addresses at the tests' own domain are touched.
 */
export default async function globalTeardown() {
  // Playwright doesn't read `.env`; CI and Docker set the variable themselves.
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile();
    } catch {
      return;
    }
  }
  if (!process.env.DATABASE_URL) return;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`delete from "user" where email like $1`, [`e2e-%@${E2E_EMAIL_DOMAIN}`]);
  } finally {
    await client.end();
  }
}
