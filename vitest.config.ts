import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Vitest's default `include` also matches *.spec.ts, which would sweep up the
    // Playwright suite in __tests__/e2e — those import @playwright/test and want a
    // browser, so `npm test` would die on them. Playwright owns that directory.
    exclude: [...configDefaults.exclude, "__tests__/e2e/**"],
    coverage: {
      provider: "v8",
      // Report on every source file in scope, not just the ones a test happened
      // to import — otherwise a completely untested module silently counts as
      // "no data" instead of 0%, and coverage looks better than it is.
      include: ["lib/**/*.{ts,tsx}", "actions/**/*.ts", "app/api/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        // Type-only modules have no executable lines to cover.
        "lib/**/types.ts",
      ],
      reporter: ["text", "html"],
      // A floor so coverage cannot silently regress. Raise as suites are added.
      thresholds: {
        statements: 82,
        branches: 76,
        functions: 87,
        lines: 82,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
