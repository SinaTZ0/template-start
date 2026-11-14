import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;

/*===== Playwright Config =====*/
export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // Results in the terminal, and the HTML report on disk without a server that waits for Ctrl+C after a failure
  // (`pnpm exec playwright show-report` opens it).
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Smoke tests run against the production build, not the dev server.
  webServer: {
    command: "pnpm build && pnpm start",
    url: `http://localhost:${PORT}`,
    // Better-Auth accepts sign-up only from its own origin, and `.env` names the dev server's.
    env: { PORT: String(PORT), BETTER_AUTH_URL: `http://localhost:${PORT}` },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
