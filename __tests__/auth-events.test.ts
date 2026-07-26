import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the `events.signIn` callback in lib/auth.ts (issue #188).
 *
 * A Strava *login* must leave the account in the same state as the Strava
 * *connect* action (`handleStravaCallback`): tokens mirrored into `strava_tokens`
 * (AES-256-GCM), the athlete id recorded on the user, and an initial sync fired.
 *
 * lib/auth.ts calls `NextAuth(config)` at import time, so we cannot import the
 * callback directly. Instead we mock `next-auth` to capture the config object it
 * receives, then exercise the real `config.events.signIn` against mocked
 * collaborators (no network, DB, crypto or NextAuth internals are touched):
 *   - @/lib/crypto      (encrypt)
 *   - @/lib/db/queries  (upsertStravaTokens)
 *   - @/lib/db          (db.update(...).set(...).where(...))
 *   - @/lib/strava/sync (syncStravaActivities)
 *   - @/lib/observability (captureError)
 */

// biome-ignore lint/suspicious/noExplicitAny: test fixtures and fluent mocks are partial by design
type Any = any;

const mocks = vi.hoisted(() => {
  return {
    capturedConfig: undefined as Any,
    encrypt: vi.fn(),
    upsertStravaTokens: vi.fn(),
    syncStravaActivities: vi.fn(),
    captureError: vi.fn(),
    // db.update(table).set(values).where(cond) — a chainable fluent stub.
    dbWhere: vi.fn(),
    dbSet: vi.fn(),
    dbUpdate: vi.fn(),
  };
});

// Capture the config lib/auth.ts hands to NextAuth, and return a harmless stub
// for the { handlers, auth, signIn, signOut } it destructures.
vi.mock("next-auth", () => ({
  default: (config: Any) => {
    mocks.capturedConfig = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));

// The adapter + real DB instance must not be constructed for a unit test.
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: () => ({}) }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({}),
  db: { update: mocks.dbUpdate },
}));
vi.mock("@/drizzle/schema", () => ({
  users: { id: "users.id" },
  accounts: {},
  sessions: {},
  verificationTokens: {},
}));

vi.mock("@/lib/crypto", () => ({ encrypt: mocks.encrypt }));
vi.mock("@/lib/db/queries", () => ({ upsertStravaTokens: mocks.upsertStravaTokens }));
vi.mock("@/lib/strava/sync", () => ({ syncStravaActivities: mocks.syncStravaActivities }));
vi.mock("@/lib/observability", () => ({ captureError: mocks.captureError }));

// drizzle-orm's eq() is called inside the callback's .where(); a thin passthrough
// keeps the assertion simple without pulling in the real comparator.
vi.mock("drizzle-orm", () => ({
  eq: (col: Any, val: Any) => ({ __eq: [col, val] }),
}));

// Importing lib/auth.ts runs NextAuth(config) → populates mocks.capturedConfig.
import "@/lib/auth";

// The real callback under test.
type SignInEvent = (args: Any) => Promise<void>;
const signIn: SignInEvent = mocks.capturedConfig.events.signIn;

// A realistic NextAuth Strava account (field names mirror the OAuth token
// response NextAuth stashes on `account`).
const stravaAccount = {
  provider: "strava",
  providerAccountId: "42",
  access_token: "access-token-xyz",
  refresh_token: "refresh-token-abc",
  expires_at: 4_000_000_000,
  scope: "read,activity:read_all",
};

const user = { id: "user-1", email: "strava_42@users.noreply.stride-run.club" };

// What our mocked encrypt() returns — a single-IV blob over both tokens.
const blobFixture = { iv: "deadbeef", authTag: "cafe", encrypted: "ENCRYPTED_BLOB" };

beforeEach(() => {
  mocks.encrypt.mockReturnValue(blobFixture);
  mocks.upsertStravaTokens.mockResolvedValue(undefined);
  mocks.syncStravaActivities.mockResolvedValue(0);

  // db.update(table).set(values).where(cond) resolves once where() is awaited.
  mocks.dbWhere.mockResolvedValue(undefined);
  mocks.dbSet.mockReturnValue({ where: mocks.dbWhere });
  mocks.dbUpdate.mockReturnValue({ set: mocks.dbSet });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// Provider / identity gating
// ===========================================================================

describe("events.signIn — gating", () => {
  it("is wired onto the NextAuth config", () => {
    expect(typeof signIn).toBe("function");
  });

  it("ignores a non-Strava provider (e.g. the dev credentials login)", async () => {
    await signIn({ user, account: { ...stravaAccount, provider: "credentials" } });

    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.upsertStravaTokens).not.toHaveBeenCalled();
    expect(mocks.syncStravaActivities).not.toHaveBeenCalled();
  });

  it("ignores a sign-in with no account", async () => {
    await signIn({ user, account: null });

    expect(mocks.upsertStravaTokens).not.toHaveBeenCalled();
  });

  it("does nothing when the user has no id", async () => {
    await signIn({ user: { email: "x@y.z" }, account: stravaAccount });

    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.upsertStravaTokens).not.toHaveBeenCalled();
  });

  it("does nothing when the account has no access token", async () => {
    await signIn({ user, account: { ...stravaAccount, access_token: undefined } });

    expect(mocks.upsertStravaTokens).not.toHaveBeenCalled();
    expect(mocks.syncStravaActivities).not.toHaveBeenCalled();
  });

  it("does nothing when the account has no providerAccountId", async () => {
    await signIn({ user, account: { ...stravaAccount, providerAccountId: undefined } });

    expect(mocks.upsertStravaTokens).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Token mirroring — parity with handleStravaCallback
// ===========================================================================

describe("events.signIn — token mirroring", () => {
  it("encrypts both tokens together under a single IV", async () => {
    await signIn({ user, account: stravaAccount });

    expect(mocks.encrypt).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.encrypt.mock.calls[0][0])).toEqual({
      access_token: "access-token-xyz",
      refresh_token: "refresh-token-abc",
    });
  });

  it("upserts the encrypted blob with iv + authTag and an empty refresh column", async () => {
    await signIn({ user, account: stravaAccount });

    expect(mocks.upsertStravaTokens).toHaveBeenCalledTimes(1);
    const input = mocks.upsertStravaTokens.mock.calls[0][0];
    expect(input).toMatchObject({
      userId: "user-1",
      accessTokenEnc: "ENCRYPTED_BLOB",
      refreshTokenEnc: "",
      iv: "deadbeef",
      authTag: "cafe",
      scope: "read,activity:read_all",
    });
  });

  it("converts the unix expires_at to a Date in milliseconds", async () => {
    await signIn({ user, account: stravaAccount });

    const { expiresAt } = mocks.upsertStravaTokens.mock.calls[0][0];
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBe(4_000_000_000 * 1000);
  });

  it("defaults the scope when the account omits it", async () => {
    await signIn({ user, account: { ...stravaAccount, scope: undefined } });

    expect(mocks.upsertStravaTokens.mock.calls[0][0].scope).toBe("read,activity:read_all");
  });

  it("tolerates a missing refresh token (stores an empty string)", async () => {
    await signIn({ user, account: { ...stravaAccount, refresh_token: undefined } });

    expect(JSON.parse(mocks.encrypt.mock.calls[0][0])).toEqual({
      access_token: "access-token-xyz",
      refresh_token: "",
    });
  });

  it("links the Strava athlete id onto the user row", async () => {
    await signIn({ user, account: stravaAccount });

    expect(mocks.dbUpdate).toHaveBeenCalledTimes(1);
    const setValues = mocks.dbSet.mock.calls[0][0];
    expect(setValues.stravaAthleteId).toBe(42);
    expect(setValues.updatedAt).toBeInstanceOf(Date);
    expect(mocks.dbWhere).toHaveBeenCalledTimes(1);
  });

  it("skips the athlete link when the providerAccountId is non-numeric", async () => {
    await signIn({ user, account: { ...stravaAccount, providerAccountId: "not-a-number" } });

    // Tokens still mirror; only the numeric athlete-id link is skipped.
    expect(mocks.upsertStravaTokens).toHaveBeenCalledTimes(1);
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it("stores tokens before linking the athlete id", async () => {
    const order: string[] = [];
    mocks.upsertStravaTokens.mockImplementationOnce(async () => {
      order.push("upsert");
    });
    mocks.dbUpdate.mockImplementationOnce(() => {
      order.push("update");
      return { set: mocks.dbSet };
    });

    await signIn({ user, account: stravaAccount });

    expect(order).toEqual(["upsert", "update"]);
  });
});

// ===========================================================================
// Initial sync
// ===========================================================================

describe("events.signIn — initial sync", () => {
  it("kicks off a full sync for the user after tokens are stored", async () => {
    await signIn({ user, account: stravaAccount });

    expect(mocks.syncStravaActivities).toHaveBeenCalledTimes(1);
    expect(mocks.syncStravaActivities).toHaveBeenCalledWith("user-1");
  });

  it("syncs only after tokens are persisted (never before)", async () => {
    const order: string[] = [];
    mocks.upsertStravaTokens.mockImplementationOnce(async () => {
      order.push("upsert");
    });
    mocks.syncStravaActivities.mockImplementationOnce(async () => {
      order.push("sync");
      return 0;
    });

    await signIn({ user, account: stravaAccount });

    expect(order.indexOf("upsert")).toBeLessThan(order.indexOf("sync"));
  });
});

// ===========================================================================
// Best-effort error handling — a sign-in must never fail on mirroring
// ===========================================================================

describe("events.signIn — best-effort resilience", () => {
  it("swallows a sync failure and records it (sign-in still succeeds)", async () => {
    mocks.syncStravaActivities.mockRejectedValueOnce(new Error("Strava API error 429"));

    await expect(signIn({ user, account: stravaAccount })).resolves.toBeUndefined();
    expect(mocks.upsertStravaTokens).toHaveBeenCalledTimes(1);
    expect(mocks.captureError).toHaveBeenCalledWith(
      "auth.events.signIn.initialSync",
      expect.any(Error)
    );
  });

  it("swallows a mirroring failure and records it (sign-in still succeeds)", async () => {
    mocks.encrypt.mockImplementationOnce(() => {
      throw new Error("ENCRYPTION_KEY environment variable is not set");
    });

    await expect(signIn({ user, account: stravaAccount })).resolves.toBeUndefined();
    expect(mocks.upsertStravaTokens).not.toHaveBeenCalled();
    expect(mocks.syncStravaActivities).not.toHaveBeenCalled();
    expect(mocks.captureError).toHaveBeenCalledWith(
      "auth.events.signIn.mirrorTokens",
      expect.any(Error)
    );
  });

  it("swallows a token-upsert failure and never reaches sync", async () => {
    mocks.upsertStravaTokens.mockRejectedValueOnce(new Error("unique constraint violation"));

    await expect(signIn({ user, account: stravaAccount })).resolves.toBeUndefined();
    expect(mocks.syncStravaActivities).not.toHaveBeenCalled();
    expect(mocks.captureError).toHaveBeenCalledWith(
      "auth.events.signIn.mirrorTokens",
      expect.any(Error)
    );
  });
});
