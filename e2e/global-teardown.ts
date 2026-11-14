import { setTimeout } from "node:timers/promises";

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
    const accounts = `e2e-%@${E2E_EMAIL_DOMAIN}`;
    // A deleted note's image is deleted by a queued job a moment later (docs/backend/jobs.md), and an account that
    // still has media can't be deleted. Wait for the job; a row that's still there after that is removed here.
    const ofAccounts = `uploaded_by in (select id from "user" where email like $1)`;
    for (let attempt = 0; attempt < 20; attempt++) {
      const left = await client.query(`select 1 from media where ${ofAccounts} limit 1`, [accounts]);
      if (left.rowCount === 0) break;
      await setTimeout(500);
    }
    await client.query(`delete from media where ${ofAccounts}`, [accounts]);
    await client.query(`delete from "user" where email like $1`, [accounts]);
  } finally {
    await client.end();
  }
}
