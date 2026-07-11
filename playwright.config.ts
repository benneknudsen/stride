import { defineConfig, devices } from "@playwright/test";

const PORT = 6969;
const BASE_URL = `http://localhost:${PORT}`;

/** Where auth.setup.ts parks the signed-in cookie jar for the other projects. */
export const STORAGE_STATE = "__tests__/e2e/.auth/user.json";

export default defineConfig({
  testDir: "./__tests__/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Every Cobalt Glass page opens on an entrance animation — cg-fade-up on the
    // bento cards, the count-up stats, the timeline's staggered dots. All of them
    // honour `motion-reduce`, so asking for reduced motion lands the DOM in its
    // final state instead of racing assertions against a 0.6s fade. It lives under
    // contextOptions: it is not a top-level `use` option.
    contextOptions: { reducedMotion: "reduce" },
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],

  // `npm run dev`, not `npm start`. proxy.ts auth-gates every route except /demo
  // and /login, and the only way to sign in without a live Google OAuth app or a
  // mail round-trip is the Credentials provider in auth.config.ts — which is
  // compiled out unless NODE_ENV is "development". Against a production server
  // three of the four suites would sit on the login screen.
  webServer: {
    command: "npm run dev",
    // Health-check the one public page: "/" answers 307 → /login when signed out.
    url: `${BASE_URL}/demo`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
