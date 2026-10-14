import { defineConfig } from "vitest/config";

/*===== Vitest Config =====*/
// Kept separate from vite.config.ts so the React Router plugin doesn't run during unit tests.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["app/**/*.test.{ts,tsx}"],
    environment: "node",
    passWithNoTests: true,
  },
});
