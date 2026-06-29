import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for actions/strava.ts.
 *
 * The module exposes two server actions around the Strava PKCE OAuth flow:
 *   - connectStrava()                       → generates PKCE, stores the verifier
 *                                             + CSRF state in an httpOnly cookie,
 *                                             returns the authorize URL
 *   - handleStravaCallback(code, verifier)  → session-gated RPC that exchanges the
 *                                             code, encrypts + upserts the tokens,
 *                                             and links the Strava athlete id
 *
 * Everything the actions reach out to is mocked so no network, DB, crypto or
 * cookie store is touched:
 *   - @/lib/strava/oauth  (generatePkce, getAuthorizationUrl, exchangeCodeForTokens)
 *   - @/lib/crypto        (encrypt)
 *   - @/lib/db/queries    (upsertStravaTokens)
 *   - @/lib/db            (db.update(...).set(...).where(...))
 *   - @/lib/auth          (auth — the NextAuth session)
 *   - next/headers        (cookies)
 *   - globalThis.crypto.randomUUID (the CSRF state)
 */

// biome-ignore lint/suspicious/noExplicitAny: test fixtures and fluent mocks are partial by design
type Any = any;

// ---------------------------------------------------------------------------
// Mocks — declared with vi.hoisted so the vi.mock factories can close over them.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  return {
    generatePkce: vi.fn(),
    getAuthorizationUrl: vi.fn(),
    exchangeCodeForTokens: vi.fn(),
    encrypt: vi.fn(),
    upsertStravaTokens: vi.fn(),
    auth: vi.fn(),
    cookieSet: vi.fn(),
    // db.update(table).set(values).where(cond) — a chainable fluent stub.
    dbWhere: vi.fn(),
    dbSet: vi.fn(),
    dbUpdate: vi.fn(),
  };
});

vi.mock("@/lib/strava/oauth", () => ({
  generatePkce: mocks.generatePkce,
  getAuthorizationUrl: mocks.getAuthorizationUrl,
  exchangeCodeForTokens: mocks.exchangeCodeForTokens,
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: mocks.encrypt,
}));

vi.mock("@/lib/db/queries", () => ({
  upsertStravaTokens: mocks.upsertStravaTokens,
}));

vi.mock("@/lib/db", () => ({
  db: { update: mocks.dbUpdate },
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mocks.cookieSet })),
}));

// drizzle-orm's eq() is called inside the action's .where(); a thin passthrough
// keeps the assertion simple without pulling in the real comparator.
vi.mock("drizzle-orm", () => ({
  eq: (col: Any, val: Any) => ({ __eq: [col, val] }),
}));

import { connectStrava, handleStravaCallback } from "@/actions/strava";

const STRAVA_COOKIE = "strava_oauth";

// Realistic Strava token fixture (field names mirror the API exactly).
const tokensFixture = {
  token_type: "Bearer",
  expires_at: 4_000_000_000,
  expires_in: 21_600,
  refresh_token: "refresh-token-abc",
  access_token: "access-token-xyz",
  athlete: { id: 42, username: "runner" },
};

// What our mocked encrypt() returns — a single-IV blob over both tokens.
const blobFixture = { iv: "deadbeef", authTag: "cafe", encrypted: "ENCRYPTED_BLOB" };

beforeEach(() => {
  mocks.generatePkce.mockReturnValue({
    codeVerifier: "verifier-123",
    codeChallenge: "challenge-456",
  });
  mocks.getAuthorizationUrl.mockReturnValue("https://www.strava.com/oauth/authorize?x=1");
  mocks.exchangeCodeForTokens.mockResolvedValue(tokensFixture);
  mocks.encrypt.mockReturnValue(blobFixture);
  mocks.upsertStravaTokens.mockResolvedValue(undefined);
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });

  // db.update(table).set(values).where(cond) resolves once where() is awaited.
  mocks.dbWhere.mockResolvedValue(undefined);
  mocks.dbSet.mockReturnValue({ where: mocks.dbWhere });
  mocks.dbUpdate.mockReturnValue({ set: mocks.dbSet });

  // Deterministic CSRF state so we can assert it flows cookie → authorize URL.
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-1111-1111-1111-111111111111");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ===========================================================================
// connectStrava
// ===========================================================================

describe("connectStrava", () => {
  it("generates a fresh PKCE pair", async () => {
    await connectStrava();

    expect(mocks.generatePkce).toHaveBeenCalledTimes(1);
  });

  it("returns the authorization URL built from the PKCE challenge + state", async () => {
    const result = await connectStrava();

    expect(result).toEqual({ url: "https://www.strava.com/oauth/authorize?x=1" });
    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith(
      "challenge-456",
      "11111111-1111-1111-1111-111111111111"
    );
  });

  it("stores the verifier and state in the strava_oauth cookie", async () => {
    await connectStrava();

    expect(mocks.cookieSet).toHaveBeenCalledTimes(1);
    const [name, value] = mocks.cookieSet.mock.calls[0];
    expect(name).toBe(STRAVA_COOKIE);
    expect(JSON.parse(value)).toEqual({
      v: "verifier-123",
      s: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("persists the verifier as an httpOnly, lax, 10-minute, root-path cookie", async () => {
    await connectStrava();

    const opts = mocks.cookieSet.mock.calls[0][2];
    expect(opts).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  });

  it("does not put the PKCE verifier into the authorization URL params", async () => {
    await connectStrava();

    // The challenge — not the verifier — is what reaches the URL builder.
    const [challenge, state] = mocks.getAuthorizationUrl.mock.calls[0];
    expect(challenge).toBe("challenge-456");
    expect(challenge).not.toBe("verifier-123");
    expect(state).not.toBe("verifier-123");
  });

  it("uses the same state value in the cookie and the authorization URL (CSRF binding)", async () => {
    await connectStrava();

    const cookieState = JSON.parse(mocks.cookieSet.mock.calls[0][1]).s;
    const urlState = mocks.getAuthorizationUrl.mock.calls[0][1];
    expect(cookieState).toBe(urlState);
  });

  it("marks the cookie secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await connectStrava();

    expect(mocks.cookieSet.mock.calls[0][2].secure).toBe(true);
  });

  it("leaves the cookie insecure outside production (so it works on http://localhost)", async () => {
    vi.stubEnv("NODE_ENV", "development");

    await connectStrava();

    expect(mocks.cookieSet.mock.calls[0][2].secure).toBe(false);
  });

  it("propagates an error from the cookie store", async () => {
    mocks.cookieSet.mockImplementationOnce(() => {
      throw new Error("cookie write failed");
    });

    await expect(connectStrava()).rejects.toThrow("cookie write failed");
  });

  it("never reaches the token exchange or DB (it only builds an authorize URL)", async () => {
    await connectStrava();

    expect(mocks.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(mocks.upsertStravaTokens).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handleStravaCallback — auth gate
// ===========================================================================

describe("handleStravaCallback — authentication", () => {
  it("throws when there is no session", async () => {
    mocks.auth.mockResolvedValueOnce(null);

    await expect(handleStravaCallback("code", "verifier")).rejects.toThrow("Not authenticated");
  });

  it("throws when the session has no user", async () => {
    mocks.auth.mockResolvedValueOnce({});

    await expect(handleStravaCallback("code", "verifier")).rejects.toThrow("Not authenticated");
  });

  it("throws when the session user has no id", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { email: "x@y.z" } });

    await expect(handleStravaCallback("code", "verifier")).rejects.toThrow("Not authenticated");
  });

  it("does not exchange the code or write tokens for an unauthenticated caller", async () => {
    mocks.auth.mockResolvedValueOnce(null);

    await expect(handleStravaCallback("code", "verifier")).rejects.toThrow();
    expect(mocks.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.upsertStravaTokens).not.toHaveBeenCalled();
  });

  it("derives the user id from the session, never from arguments", async () => {
    await handleStravaCallback("auth-code", "verifier-123");

    expect(mocks.auth).toHaveBeenCalledTimes(1);
    expect(mocks.upsertStravaTokens.mock.calls[0][0].userId).toBe("user-1");
  });
});

// ===========================================================================
// handleStravaCallback — happy path
// ===========================================================================

describe("handleStravaCallback — token exchange + storage", () => {
  it("exchanges the authorization code using the PKCE verifier", async () => {
    await handleStravaCallback("auth-code", "verifier-123");

    expect(mocks.exchangeCodeForTokens).toHaveBeenCalledWith("auth-code", "verifier-123");
  });

  it("encrypts both tokens together under a single IV", async () => {
    await handleStravaCallback("auth-code", "verifier-123");

    expect(mocks.encrypt).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.encrypt.mock.calls[0][0])).toEqual({
      access_token: "access-token-xyz",
      refresh_token: "refresh-token-abc",
    });
  });

  it("upserts the encrypted blob with iv + authTag and an empty refresh column", async () => {
    await handleStravaCallback("auth-code", "verifier-123");

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
    await handleStravaCallback("auth-code", "verifier-123");

    const { expiresAt } = mocks.upsertStravaTokens.mock.calls[0][0];
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBe(4_000_000_000 * 1000);
  });

  it("links the Strava athlete id onto the user row", async () => {
    await handleStravaCallback("auth-code", "verifier-123");

    expect(mocks.dbUpdate).toHaveBeenCalledTimes(1);
    const setValues = mocks.dbSet.mock.calls[0][0];
    expect(setValues.stravaAthleteId).toBe(42);
    expect(setValues.updatedAt).toBeInstanceOf(Date);
    // Scoped to the session user.
    expect(mocks.dbWhere).toHaveBeenCalledTimes(1);
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

    await handleStravaCallback("auth-code", "verifier-123");

    expect(order).toEqual(["upsert", "update"]);
  });

  it("returns void on success", async () => {
    await expect(handleStravaCallback("auth-code", "verifier-123")).resolves.toBeUndefined();
  });
});

// ===========================================================================
// handleStravaCallback — athlete edge cases
// ===========================================================================

describe("handleStravaCallback — athlete linking edge cases", () => {
  it("skips the user update when the response has no athlete", async () => {
    mocks.exchangeCodeForTokens.mockResolvedValueOnce({ ...tokensFixture, athlete: undefined });

    await handleStravaCallback("auth-code", "verifier-123");

    expect(mocks.upsertStravaTokens).toHaveBeenCalledTimes(1);
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it("skips the user update when the athlete has no id", async () => {
    mocks.exchangeCodeForTokens.mockResolvedValueOnce({
      ...tokensFixture,
      athlete: { username: "no-id" },
    });

    await handleStravaCallback("auth-code", "verifier-123");

    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it("still upserts tokens even when athlete linking is skipped", async () => {
    mocks.exchangeCodeForTokens.mockResolvedValueOnce({ ...tokensFixture, athlete: undefined });

    await handleStravaCallback("auth-code", "verifier-123");

    expect(mocks.upsertStravaTokens).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// handleStravaCallback — error propagation
// ===========================================================================

describe("handleStravaCallback — error propagation", () => {
  it("propagates a failed token exchange and writes nothing", async () => {
    mocks.exchangeCodeForTokens.mockRejectedValueOnce(
      new Error("Strava token exchange failed (400): bad code")
    );

    await expect(handleStravaCallback("bad-code", "verifier")).rejects.toThrow(
      "Strava token exchange failed (400): bad code"
    );
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.upsertStravaTokens).not.toHaveBeenCalled();
  });

  it("propagates an encryption failure before any DB write", async () => {
    mocks.encrypt.mockImplementationOnce(() => {
      throw new Error("ENCRYPTION_KEY environment variable is not set");
    });

    await expect(handleStravaCallback("code", "verifier")).rejects.toThrow(
      "ENCRYPTION_KEY environment variable is not set"
    );
    expect(mocks.upsertStravaTokens).not.toHaveBeenCalled();
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it("propagates a token-upsert DB error and never links the athlete", async () => {
    mocks.upsertStravaTokens.mockRejectedValueOnce(new Error("unique constraint violation"));

    await expect(handleStravaCallback("code", "verifier")).rejects.toThrow(
      "unique constraint violation"
    );
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it("propagates a failure while linking the athlete id", async () => {
    mocks.dbWhere.mockRejectedValueOnce(new Error("connection reset"));

    await expect(handleStravaCallback("code", "verifier")).rejects.toThrow("connection reset");
    // Tokens were already persisted before the link step failed.
    expect(mocks.upsertStravaTokens).toHaveBeenCalledTimes(1);
  });
});
