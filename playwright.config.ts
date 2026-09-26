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

  // `npm run dev`, not `npm start`. proxy.ts no longer auth-gates any app route
  // (#100) — signed-out visitors get the demo fallbacks (#84) — but the suites
  // that sign in still need a server that accepts a login, and the only way in
  // without a live Google OAuth app or a mail round-trip is the Credentials
  // provider in auth.config.ts, which is compiled out unless NODE_ENV is
  // "development". Against a production server those suites would sit on the
  // login screen.
  webServer: {
    command: "npm run dev",
    // Health-check /login — a real page, unlike /demo, which next.config.ts only
    // rewrites to "/?demo=1". A 200 here proves the dev server is serving pages.
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Unmounts Next's dev overlay for this server only (#289). The overlay
    // mounts a `nextjs-portal` shadow root holding a `position: fixed` toast in
    // the bottom-left corner. The mobile BottomTabBar is `fixed inset-x-3
    // bottom-…` with `justify-around`, so Hjem — its first tab — sits exactly
    // there, and Playwright's hit test refuses the click with "nextjs-portal …
    // subtree intercepts pointer events". Only the e2e server loses the overlay;
    // `npm run dev` for a human is untouched.
    //
    // `devIndicators: false` is NOT enough here, which is why this is an env var
    // and not a next.config.ts flag. It only hides the badge while the issue
    // count is zero; with any runtime error present the overlay keeps a disabled
    // error pill in the same corner, and the e2e DB failures alone are enough to
    // produce those. The overlay as a whole is what has to go.
    //
    // The trade-off: the browser no longer renders compile/runtime error
    // overlays during e2e. Errors still reach the dev server's stdout and
    // Playwright's pageerror events, so a broken run still fails loudly.
    //
    // process.env spreads first so the dev server keeps DATABASE_URL, AUTH_SECRET
    // and friends. A human's own `npm run dev` on :6969 is not covered —
    // reuseExistingServer above would adopt it as-is — so stop that server first.
    env: { ...process.env, NEXT_PRIVATE_DISABLE_DEV_OVERLAY_UX: "1" },
  },
});
