import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the lazy `AUTH_URL` production guard in lib/auth.ts (issue #272).
 *
 * `auth.config.ts` pins `trustHost: true`, so a self-hosted production deploy
 * without `AUTH_URL` would build OAuth callback URLs from a spoofable Host
 * header. The guard must:
 *   - throw (after captureError) on the first `auth()` call when
 *     NODE_ENV=production and AUTH_URL is unset,
 *   - keep failing closed on every subsequent call while misconfigured,
 *   - never interfere outside production, and
 *   - exempt the Next.js build phase (prerender probes call `auth()` with
 *     NODE_ENV=production, and local/CI builds have no AUTH_URL).
 *
 * lib/auth.ts memoises a successful check in module scope, so each test loads a
 * fresh module via `vi.resetModules()` + dynamic import. NextAuth and every
 * side-effectful collaborator is mocked — mirroring __tests__/auth-events.test.ts.
 */

// biome-ignore lint/suspicious/noExplicitAny: test fixtures and fluent mocks are partial by design
type Any = any;

const mocks = vi.hoisted(() => ({
  nodeAuth: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: (_config: Any) => ({
    handlers: {},
    auth: mocks.nodeAuth,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: () => ({}) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}), db: {} }));
vi.mock("@/drizzle/schema", () => ({
  users: {},
  accounts: {},
  sessions: {},
  verificationTokens: {},
}));
vi.mock("@/lib/crypto", () => ({ encrypt: vi.fn() }));
vi.mock("@/lib/db/queries", () => ({ upsertStravaTokens: vi.fn() }));
vi.mock("@/lib/strava/sync", () => ({ syncStravaActivities: vi.fn() }));
vi.mock("@/lib/observability", () => ({ captureError: mocks.captureError }));

/** Load a fresh lib/auth module so the guard's memoisation starts clean. */
async function loadAuth() {
  vi.resetModules();
  return import("@/lib/auth");
}

const SESSION_SENTINEL = { user: { id: "user-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.nodeAuth.mockResolvedValue(SESSION_SENTINEL);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AUTH_URL production guard", () => {
  it("throws and reports when production runs without AUTH_URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "");
    const { auth } = await loadAuth();

    expect(() => auth()).toThrow(/AUTH_URL is not set/);
    expect(mocks.captureError).toHaveBeenCalledWith("auth.boot.authUrl", expect.any(Error));
    expect(mocks.nodeAuth).not.toHaveBeenCalled();
  });

  it("keeps failing closed on every call while misconfigured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "");
    const { auth } = await loadAuth();

    expect(() => auth()).toThrow(/AUTH_URL/);
    expect(() => auth()).toThrow(/AUTH_URL/);
    expect(mocks.captureError).toHaveBeenCalledTimes(2);
    expect(mocks.nodeAuth).not.toHaveBeenCalled();
  });

  it("passes through to NextAuth when production has AUTH_URL set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "https://stride.example");
    const { auth } = await loadAuth();

    await expect(auth()).resolves.toBe(SESSION_SENTINEL);
    expect(mocks.captureError).not.toHaveBeenCalled();
    expect(mocks.nodeAuth).toHaveBeenCalledTimes(1);
  });

  it("never fires outside production (dev runs without AUTH_URL)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_URL", "");
    const { auth } = await loadAuth();

    await expect(auth()).resolves.toBe(SESSION_SENTINEL);
    expect(mocks.captureError).not.toHaveBeenCalled();
  });

  it("exempts the Next.js build phase (prerender probes must not fail the build)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const { auth } = await loadAuth();

    await expect(auth()).resolves.toBe(SESSION_SENTINEL);
    expect(mocks.captureError).not.toHaveBeenCalled();
  });
});
