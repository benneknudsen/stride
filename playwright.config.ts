import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

const PORT = 6969;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * PIDs listening on the dev port right now, or `[]` when the answer is unknown.
 *
 * `lsof` is the direct question — is a socket bound to :6969 — and unlike
 * Next's own `.next/dev/lock` (a pid/port record Playwright's SIGKILL teardown
 * leaves behind) it cannot go stale. Where `lsof` is absent (Windows, a minimal
 * container) this returns `[]` and the run falls through to Playwright's own
 * port check, which is the backstop.
 */
function devPortListeners(): number[] {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((line) => Number.parseInt(line, 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

/**
 * Refuse the run — with the fix in the message — when the dev port is taken.
 *
 * `reuseExistingServer: false` already stops the wrong server from being
 * adopted, but Playwright reports that as "… is already used, make sure that
 * nothing is running on the port/url or set reuseExistingServer:true in
 * config.webServer", and the second half of that sentence is precisely the
 * switch that recreates #297. This says what is actually wrong instead.
 *
 * Runner process only: Playwright evaluates this module once in the runner
 * (`playwright test`, so "test" is in argv) and again in every worker, which is
 * spawned as workerProcessEntry.js and has no such argument. The workers load
 * this file *after* the web server is up, so an unguarded check here would kill
 * every worker on a healthy run. If a future Playwright drops the subcommand
 * from argv the guard goes quiet and Playwright's message stands — the failure
 * mode is a less helpful message, not a broken suite.
 */
function refuseIfDevPortTaken() {
  if (!process.argv.includes("test")) return;

  const pids = devPortListeners();
  if (pids.length === 0) return;

  console.error(
    [
      `e2e needs its own dev server on :${PORT}, but something is already listening there (pid ${pids.join(", ")}).`,
      "",
      "This suite starts `npm run dev` with NEXT_PRIVATE_DISABLE_DEV_OVERLAY_UX=1 so Next's dev",
      "overlay cannot cover the mobile BottomTabBar. A server started by hand does not have that,",
      "and reusing it (the old `reuseExistingServer: !process.env.CI`) is how the e2e result came",
      "to depend on the developer: the overlay landed on the Hjem tab and navigation.spec.ts failed",
      '30s later on "nextjs-portal … subtree intercepts pointer events", with nothing in the log',
      "connecting that to a dev server you left running (#297).",
      "",
      "Stop it and run the suite again:",
      "",
      `    kill ${pids.join(" ")}        # or ctrl-c in the terminal running npm run dev`,
      "",
      'Do not "fix" this by setting reuseExistingServer: true — that is the bug, not the fix.',
    ].join("\n")
  );
  process.exit(1);
}

refuseIfDevPortTaken();

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
    // Never adopt a server that is already listening (#297). This was
    // `!process.env.CI`, and it coupled reuse to configuration: Playwright asks
    // only "is something on :6969?", never "was it started with the env below",
    // so a human's own `npm run dev` — no NEXT_PRIVATE_DISABLE_DEV_OVERLAY_UX —
    // got adopted as-is. The overlay came back, the Hjem tab sat under it, and
    // navigation.spec.ts died 30s into the run on "nextjs-portal … subtree
    // intercepts pointer events". CI never hit it, because CI already ran with
    // reuse off, which is what made this read as "nothing changed".
    //
    // What refusing costs: a fresh `next dev` per run. A full 16-test suite
    // measured 15s wall with a warm .next/dev cache, once at the cold-cache
    // start-up cost. What it buys: the server under test is always one this file
    // configured. No warm path is lost by giving up reuse — Playwright kills the
    // webServer it spawned when the run ends, so the only server reuse could
    // ever find is a human's, and that is exactly the one that must not be
    // adopted. Slow green beats fast red.
    //
    // The two other ways to decouple were worse:
    //
    // - A marker proving the adopted server is configured. Next already writes
    //   one (`.next/dev/lock`, a pid/port record) and it is byte-identical for a
    //   configured and an unconfigured server, so it cannot answer the question
    //   — "was this started with the env var". Anything that could would have to
    //   be written by the e2e command itself, and that command only runs when
    //   Playwright decides to start a server, i.e. never on the reuse path it
    //   was supposed to vet. Matching "is that the listening PID" on top needs a
    //   per-platform probe. A mechanism that is dead on arrival.
    // - A dedicated e2e port (6970) so :6969 could never be adopted. Next 16
    //   allows exactly one `next dev` per project directory: a second one exits
    //   with "⨯ Another next dev server is already running." and never binds, so
    //   it cannot reach the new port. The option does not exist in this repo.
    //
    // The one manual step left is stopping a dev server that is already on
    // :6969; refuseIfDevPortTaken above turns Playwright's generic port error
    // into that instruction, and the run is otherwise a single command.
    reuseExistingServer: false,
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
    // and friends. A human's own `npm run dev` on :6969 never reaches the suite:
    // reuseExistingServer above refuses it, and refuseIfDevPortTaken stops the
    // run first with the reason. Only this server loses the overlay.
    env: { ...process.env, NEXT_PRIVATE_DISABLE_DEV_OVERLAY_UX: "1" },
  },
});
