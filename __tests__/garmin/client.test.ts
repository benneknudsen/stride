import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for lib/garmin/client.ts.
 *
 * The module exposes:
 *   - createGarminClient(accessToken) → { getActivities, getUserId, fetchCallback },
 *     thin fetch() wrappers over the Garmin Wellness API. fetchCallback is
 *     SSRF-guarded: it only attaches the bearer token to allowlisted hosts and
 *     refuses to follow redirects.
 *   - persistGarminTokens(userId, tokens) → seals both tokens under one IV and
 *     upserts them via saveGarminTokens.
 *   - withGarminTokenRefresh(userId) → loads the encrypted row, decrypts it,
 *     refreshes when within 60s of expiry (unless the refresh token itself has
 *     expired — Garmin's does, Strava's does not), persists, and returns a client.
 *
 * Everything external is mocked:
 *   - global fetch (the Garmin API)
 *   - @/lib/db/index      (Drizzle client — chainable thenable builder stub)
 *   - @/lib/crypto        (encrypt/decrypt)
 *   - @/lib/db/queries    (saveGarminTokens — the persist path)
 *   - @/lib/garmin/oauth  (refreshAccessToken)
 *
 * The real drizzle schema, `eq`, and lib/garmin/config are left intact — config
 * only reads env-overridable constants and the callback allowlist.
 */

// ---------------------------------------------------------------------------
// Mocks (hoisted so vi.mock factories can close over them)
// ---------------------------------------------------------------------------

const dbMock = vi.hoisted(() => {
  // biome-ignore lint/suspicious/noExplicitAny: mirrors Drizzle's loosely-typed fluent builder
  type Any = any;

  const calls: Record<string, Any[][]> = {};
  let result: Any = [];
  let rejection: Any = null;

  const record = (name: string, args: Any[]) => {
    if (!calls[name]) {
      calls[name] = [];
    }
    calls[name].push(args);
  };

  const builder: Any = {
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable stubbing Drizzle's awaitable builder
    then: (onFulfilled: Any, onRejected: Any) =>
      (rejection ? Promise.reject(rejection) : Promise.resolve(result)).then(
        onFulfilled,
        onRejected
      ),
  };
  for (const m of ["from", "where", "limit"]) {
    builder[m] = (...args: Any[]) => {
      record(m, args);
      return builder;
    };
  }

  const select = vi.fn((...args: Any[]) => {
    record("select", args);
    return builder;
  });

  return {
    db: { select },
    calls,
    setResult(r: Any) {
      result = r;
      rejection = null;
    },
    setError(e: Any) {
      rejection = e;
    },
    reset() {
      for (const k of Object.keys(calls)) {
        delete calls[k];
      }
      result = [];
      rejection = null;
      select.mockClear();
    },
  };
});

const cryptoMock = vi.hoisted(() => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}));

const oauthMock = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
}));

const queriesMock = vi.hoisted(() => ({
  saveGarminTokens: vi.fn(),
}));

vi.mock("@/lib/db/index", () => ({ db: dbMock.db }));
vi.mock("@/lib/crypto", () => ({
  decrypt: cryptoMock.decrypt,
  encrypt: cryptoMock.encrypt,
}));
vi.mock("@/lib/garmin/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/garmin/oauth")>()),
  refreshAccessToken: oauthMock.refreshAccessToken,
}));
vi.mock("@/lib/db/queries", () => ({ saveGarminTokens: queriesMock.saveGarminTokens }));

import {
  createGarminClient,
  persistGarminTokens,
  withGarminTokenRefresh,
} from "@/lib/garmin/client";
import type { GarminTokensResponse } from "@/lib/garmin/types";

const API_BASE = "https://apis.garmin.com/wellness-api/rest";

// ---------------------------------------------------------------------------
// fetch helpers
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: test fixtures are partial by design
type Any = any;

function okJson(body: Any) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function errResponse(status: number, text = "") {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.reject(new Error("should not parse json on error")),
  };
}

/** A 3xx with no usable body — the shape fetchCallback sees under redirect: "manual". */
function redirectResponse(status: number) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(""),
    json: () => Promise.reject(new Error("should not parse json on redirect")),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * A fixed wall-clock instant for every test. The token-refresh path reads
 * `Date.now()` internally (client.ts) while the tests seed expiry as
 * `new Date(Date.now() + 61_000)` at setup time. Under the real clock those two
 * reads drift by a few ms, which can tip the `Math.floor(secondsLeft)` math
 * across the 60s refresh boundary and flake the suite (and leak wall-clock state
 * across files). Freezing the clock makes both reads return the same instant.
 */
const FIXED_NOW = new Date("2026-01-15T12:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  dbMock.reset();
  cryptoMock.decrypt.mockReset();
  cryptoMock.encrypt.mockReset();
  oauthMock.refreshAccessToken.mockReset();
  queriesMock.saveGarminTokens.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const sampleActivity = {
  summaryId: "abc-1",
  startTimeInSeconds: 1_700_000_000,
  activityType: "RUNNING",
  durationInSeconds: 3000,
};

// ===========================================================================
// createGarminClient — getActivities
// ===========================================================================

describe("createGarminClient.getActivities", () => {
  it("requests the upload window and returns the activity list", async () => {
    fetchMock.mockResolvedValueOnce(okJson([sampleActivity]));
    const client = createGarminClient("access-abc");

    const out = await client.getActivities(1000, 1000 + 86_400);

    expect(out).toEqual([sampleActivity]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/activities?uploadStartTimeInSeconds=1000&uploadEndTimeInSeconds=87400`,
      { headers: { Authorization: "Bearer access-abc" } }
    );
  });

  it("floors fractional window bounds (the API takes integer seconds)", async () => {
    fetchMock.mockResolvedValueOnce(okJson([]));
    const client = createGarminClient("tok");

    await client.getActivities(1000.9, 2000.9);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/activities?uploadStartTimeInSeconds=1000&uploadEndTimeInSeconds=2000`,
      expect.anything()
    );
  });

  it("returns an empty array when the window has no activities", async () => {
    fetchMock.mockResolvedValueOnce(okJson([]));
    const client = createGarminClient("tok");

    expect(await client.getActivities(0, 1)).toEqual([]);
  });

  it("throws on a non-2xx response, including status and body", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(401, "Unauthorized"));
    const client = createGarminClient("expired");

    await expect(client.getActivities(0, 1)).rejects.toThrow("Garmin API error 401: Unauthorized");
  });

  it("propagates a network-level fetch rejection", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const client = createGarminClient("tok");

    await expect(client.getActivities(0, 1)).rejects.toThrow("fetch failed");
  });
});

// ===========================================================================
// createGarminClient — getUserId
// ===========================================================================

describe("createGarminClient.getUserId", () => {
  it("requests /user/id and returns the payload", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ userId: "garmin-user-1" }));
    const client = createGarminClient("tok");

    const out = await client.getUserId();

    expect(out).toEqual({ userId: "garmin-user-1" });
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/user/id`, {
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("throws on a 500 server error", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(500, "boom"));
    const client = createGarminClient("tok");

    await expect(client.getUserId()).rejects.toThrow("Garmin API error 500: boom");
  });
});

// ===========================================================================
// createGarminClient — fetchCallback (SSRF guard)
// ===========================================================================

describe("createGarminClient.fetchCallback", () => {
  it("fetches an allowlisted https host with the bearer token and returns the body", async () => {
    fetchMock.mockResolvedValueOnce(okJson([sampleActivity]));
    const client = createGarminClient("tok");

    const out = await client.fetchCallback(
      "https://apis.garmin.com/wellness-api/rest/activities?token=x"
    );

    expect(out).toEqual([sampleActivity]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://apis.garmin.com/wellness-api/rest/activities?token=x",
      { headers: { Authorization: "Bearer tok" }, redirect: "manual" }
    );
  });

  it("rejects a non-allowlisted host WITHOUT issuing a fetch (no token leak)", async () => {
    const client = createGarminClient("tok");

    await expect(client.fetchCallback("https://evil.example.com/steal")).rejects.toThrow(
      "not an allowlisted host"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a look-alike suffix host (apis.garmin.com.evil.tld)", async () => {
    const client = createGarminClient("tok");

    await expect(client.fetchCallback("https://apis.garmin.com.evil.tld/x")).rejects.toThrow(
      "not an allowlisted host"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a plaintext http:// callback even on an allowlisted host", async () => {
    const client = createGarminClient("tok");

    await expect(client.fetchCallback("http://apis.garmin.com/x")).rejects.toThrow(
      "not an allowlisted host"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to follow a redirect from an otherwise-legitimate host", async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse(302));
    const client = createGarminClient("tok");

    await expect(client.fetchCallback("https://apis.garmin.com/x")).rejects.toThrow(
      "Garmin callback redirected (302) — refusing to follow"
    );
  });

  it("throws on a non-2xx (non-redirect) callback response", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(404, "gone"));
    const client = createGarminClient("tok");

    await expect(client.fetchCallback("https://apis.garmin.com/x")).rejects.toThrow(
      "Garmin callback error 404: gone"
    );
  });
});

// ===========================================================================
// persistGarminTokens
// ===========================================================================

const tokensResponse: GarminTokensResponse = {
  access_token: "fresh-access",
  refresh_token: "fresh-refresh",
  expires_in: 3600,
  refresh_token_expires_in: 7776000,
  scope: "activity:read",
  // biome-ignore lint/suspicious/noExplicitAny: token_type not needed for these assertions
} as any;

describe("persistGarminTokens", () => {
  beforeEach(() => {
    cryptoMock.encrypt.mockReturnValue({ iv: "iv-x", authTag: "tag-x", encrypted: "enc-x" });
  });

  it("seals both tokens under one IV and upserts the row", async () => {
    const now = 1_000_000;
    await persistGarminTokens("u1", tokensResponse, now);

    expect(cryptoMock.encrypt).toHaveBeenCalledWith(
      JSON.stringify({ access_token: "fresh-access", refresh_token: "fresh-refresh" })
    );
    expect(queriesMock.saveGarminTokens).toHaveBeenCalledTimes(1);
    expect(queriesMock.saveGarminTokens).toHaveBeenCalledWith({
      userId: "u1",
      accessTokenEnc: "enc-x",
      refreshTokenEnc: "", // both tokens live in accessTokenEnc
      iv: "iv-x",
      authTag: "tag-x",
      expiresAt: new Date(now + 3600 * 1000),
      refreshExpiresAt: new Date(now + 7776000 * 1000),
      scope: "activity:read",
    });
  });

  it("stores a null refreshExpiresAt when the response omits refresh_token_expires_in", async () => {
    const now = 2_000_000;
    // biome-ignore lint/suspicious/noExplicitAny: intentionally omitting an optional field
    const noRefreshExpiry = { ...tokensResponse, refresh_token_expires_in: undefined } as any;

    await persistGarminTokens("u1", noRefreshExpiry, now);

    expect(queriesMock.saveGarminTokens).toHaveBeenCalledWith(
      expect.objectContaining({ refreshExpiresAt: null })
    );
  });

  it("stores a null scope when the response omits it", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentionally omitting an optional field
    const noScope = { ...tokensResponse, scope: undefined } as any;

    await persistGarminTokens("u1", noScope, 3_000_000);

    expect(queriesMock.saveGarminTokens).toHaveBeenCalledWith(
      expect.objectContaining({ scope: null })
    );
  });
});

// ===========================================================================
// withGarminTokenRefresh
// ===========================================================================

/** Seed the db select() result with one encrypted Garmin token row. */
function seedTokenRow(expiresAt: Date, refreshExpiresAt: Date | null = null) {
  dbMock.setResult([
    {
      userId: "u1",
      accessTokenEnc: "enc-blob",
      refreshTokenEnc: "",
      iv: "iv-hex",
      authTag: "tag-hex",
      expiresAt,
      refreshExpiresAt,
    },
  ]);
}

function decryptedTokens(access: string, refresh: string) {
  cryptoMock.decrypt.mockReturnValue(
    JSON.stringify({ access_token: access, refresh_token: refresh })
  );
}

describe("withGarminTokenRefresh — valid (unexpired) token", () => {
  it("returns a client without refreshing when expiry is comfortably ahead", async () => {
    seedTokenRow(new Date(Date.now() + 3_600_000)); // +1h
    decryptedTokens("valid-access", "the-refresh");

    const client = await withGarminTokenRefresh("u1");

    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
    expect(queriesMock.saveGarminTokens).not.toHaveBeenCalled();
    expect(cryptoMock.decrypt).toHaveBeenCalledWith("enc-blob", "iv-hex", "tag-hex");

    // The returned client is bound to the decrypted access token.
    fetchMock.mockResolvedValueOnce(okJson([]));
    await client.getActivities(0, 1);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
      headers: { Authorization: "Bearer valid-access" },
    });
  });

  it("treats a token 61s from expiry as still valid (boundary above 60s)", async () => {
    seedTokenRow(new Date(Date.now() + 61_000));
    decryptedTokens("valid-access", "the-refresh");

    await withGarminTokenRefresh("u1");

    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
  });
});

describe("withGarminTokenRefresh — expired access token: refresh → persist → return", () => {
  beforeEach(() => {
    cryptoMock.encrypt.mockReturnValue({ iv: "new-iv", authTag: "new-tag", encrypted: "new-enc" });
    oauthMock.refreshAccessToken.mockResolvedValue(tokensResponse);
  });

  it("refreshes with the decrypted refresh token and persists the result", async () => {
    seedTokenRow(new Date(Date.now() - 1000)); // access expired
    decryptedTokens("old-access", "old-refresh");

    await withGarminTokenRefresh("u1");

    expect(oauthMock.refreshAccessToken).toHaveBeenCalledWith("old-refresh");
    expect(queriesMock.saveGarminTokens).toHaveBeenCalledTimes(1);
  });

  it("returns a client bound to the freshly refreshed access token", async () => {
    seedTokenRow(new Date(Date.now() - 1000));
    decryptedTokens("old-access", "old-refresh");

    const client = await withGarminTokenRefresh("u1");

    fetchMock.mockResolvedValueOnce(okJson([sampleActivity]));
    const out = await client.getActivities(0, 1);

    expect(out).toEqual([sampleActivity]);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
      headers: { Authorization: "Bearer fresh-access" },
    });
  });

  it("refreshes at exactly 60s from expiry (boundary not above 60s)", async () => {
    seedTokenRow(new Date(Date.now() + 60_000));
    decryptedTokens("old-access", "old-refresh");

    await withGarminTokenRefresh("u1");

    expect(oauthMock.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("propagates a refresh failure and skips the write-back", async () => {
    seedTokenRow(new Date(Date.now() - 1000));
    decryptedTokens("old-access", "old-refresh");
    oauthMock.refreshAccessToken.mockRejectedValueOnce(
      new Error("Garmin token refresh failed (400): invalid")
    );

    await expect(withGarminTokenRefresh("u1")).rejects.toThrow("token refresh failed");
    expect(queriesMock.saveGarminTokens).not.toHaveBeenCalled();
  });
});

describe("withGarminTokenRefresh — expired refresh token (Garmin-specific)", () => {
  it("throws a reconnect-required error and never fires a doomed refresh", async () => {
    // Access expired AND the refresh token itself has expired.
    seedTokenRow(new Date(Date.now() - 1000), new Date(Date.now() - 1000));
    decryptedTokens("old-access", "old-refresh");

    await expect(withGarminTokenRefresh("u1")).rejects.toThrow(
      "Garmin refresh token expired for user u1 — reconnect required"
    );
    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
    expect(queriesMock.saveGarminTokens).not.toHaveBeenCalled();
  });

  it("still refreshes when the refresh token has NOT yet expired", async () => {
    cryptoMock.encrypt.mockReturnValue({ iv: "new-iv", authTag: "new-tag", encrypted: "new-enc" });
    oauthMock.refreshAccessToken.mockResolvedValue(tokensResponse);
    seedTokenRow(new Date(Date.now() - 1000), new Date(Date.now() + 86_400_000)); // refresh good for 1d

    decryptedTokens("old-access", "old-refresh");

    await withGarminTokenRefresh("u1");

    expect(oauthMock.refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe("withGarminTokenRefresh — missing tokens", () => {
  it("throws when the user has no stored token row", async () => {
    dbMock.setResult([]);

    await expect(withGarminTokenRefresh("ghost")).rejects.toThrow(
      "No Garmin tokens found for user ghost"
    );
    expect(cryptoMock.decrypt).not.toHaveBeenCalled();
    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("propagates a database error from the token lookup", async () => {
    dbMock.setError(new Error("connection refused"));

    await expect(withGarminTokenRefresh("u1")).rejects.toThrow("connection refused");
  });
});
