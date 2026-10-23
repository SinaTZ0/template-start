import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { defineConfig } from "vitest/config";

/*===== Vitest Config =====*/
// Kept separate from vite.config.ts so the TanStack Start and Nitro plugins don't run during unit tests.
export default defineConfig({
  // Tests import message functions too (validation schemas, services).
  plugins: [paraglideVitePlugin({ project: "./project.inlang" })],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    passWithNoTests: true,
  },
});
