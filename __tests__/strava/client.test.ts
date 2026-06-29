import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for lib/strava/client.ts.
 *
 * The module under test exposes two things:
 *   - createStravaClient(accessToken) → { getActivities, getActivity }, thin
 *     wrappers over fetch() against the Strava API v3.
 *   - withTokenRefresh(userId) → loads the encrypted token row, decrypts it,
 *     refreshes via Strava OAuth when it is within 60s of expiry, re-encrypts
 *     and persists the new tokens, then returns a client bound to a valid token.
 *
 * Everything external is mocked:
 *   - global fetch (the Strava API)
 *   - @/lib/db/index   (the Drizzle client — chainable thenable builder stub)
 *   - @/lib/crypto     (encrypt/decrypt)
 *   - @/lib/strava/oauth (refreshAccessToken)
 *
 * The real drizzle schema and `eq` helper are left intact — they only build
 * inert SQL fragments that the mocked db builder ignores.
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

  // A single shared thenable builder. Every chain method records its args and
  // returns the builder; awaiting it resolves/rejects with the configured outcome.
  const builder: Any = {
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable stubbing Drizzle's awaitable builder
    then: (onFulfilled: Any, onRejected: Any) =>
      (rejection ? Promise.reject(rejection) : Promise.resolve(result)).then(
        onFulfilled,
        onRejected
      ),
  };
  for (const m of ["from", "where", "limit", "set"]) {
    builder[m] = (...args: Any[]) => {
      record(m, args);
      return builder;
    };
  }

  const select = vi.fn((...args: Any[]) => {
    record("select", args);
    return builder;
  });
  const update = vi.fn((...args: Any[]) => {
    record("update", args);
    return builder;
  });

  return {
    db: { select, update },
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
      update.mockClear();
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

vi.mock("@/lib/db/index", () => ({ db: dbMock.db }));
vi.mock("@/lib/crypto", () => ({
  decrypt: cryptoMock.decrypt,
  encrypt: cryptoMock.encrypt,
}));
vi.mock("@/lib/strava/oauth", () => ({
  refreshAccessToken: oauthMock.refreshAccessToken,
}));

import { createStravaClient, withTokenRefresh } from "@/lib/strava/client";
import type { RefreshTokenResponse, SummaryActivity } from "@/lib/strava/types";

const API_BASE = "https://www.strava.com/api/v3";

// ---------------------------------------------------------------------------
// fetch helpers
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: test fixtures are partial by design
type Any = any;

/** Build a minimal ok Response whose .json() yields `body`. */
function okJson(body: Any) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

/** Build a non-ok Response whose .text() yields `text`. */
function errResponse(status: number, text = "") {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.reject(new Error("should not parse json on error")),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  dbMock.reset();
  cryptoMock.decrypt.mockReset();
  cryptoMock.encrypt.mockReset();
  oauthMock.refreshAccessToken.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// A small, realistic SummaryActivity fixture.
const sampleActivity: Partial<SummaryActivity> = {
  id: 123,
  name: "Morning Run",
  distance: 10000,
  moving_time: 3000,
  type: "Run",
  sport_type: "Run",
  start_date: "2026-06-29T06:00:00Z",
  average_heartrate: 150,
};

// ===========================================================================
// createStravaClient — getActivities
// ===========================================================================

describe("createStravaClient.getActivities", () => {
  it("requests the default page/per_page and returns the activity list", async () => {
    fetchMock.mockResolvedValueOnce(okJson([sampleActivity]));
    const client = createStravaClient("access-abc");

    const out = await client.getActivities();

    expect(out).toEqual([sampleActivity]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/athlete/activities?page=1&per_page=30`, {
      headers: { Authorization: "Bearer access-abc" },
    });
  });

  it("forwards explicit page and perPage query params", async () => {
    fetchMock.mockResolvedValueOnce(okJson([]));
    const client = createStravaClient("tok");

    await client.getActivities(3, 50);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/athlete/activities?page=3&per_page=50`,
      expect.anything()
    );
  });

  it("returns an empty array when the athlete has no activities", async () => {
    fetchMock.mockResolvedValueOnce(okJson([]));
    const client = createStravaClient("tok");

    expect(await client.getActivities()).toEqual([]);
  });

  it("supports paginating through multiple pages", async () => {
    const page1 = [{ id: 1 }, { id: 2 }];
    const page2 = [{ id: 3 }];
    fetchMock.mockResolvedValueOnce(okJson(page1)).mockResolvedValueOnce(okJson(page2));
    const client = createStravaClient("tok");

    const first = await client.getActivities(1, 2);
    const second = await client.getActivities(2, 2);

    expect(first).toEqual(page1);
    expect(second).toEqual(page2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${API_BASE}/athlete/activities?page=1&per_page=2`,
      expect.anything()
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${API_BASE}/athlete/activities?page=2&per_page=2`,
      expect.anything()
    );
  });

  it("throws on a 401 Unauthorized, including status and body", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(401, "Authorization Error"));
    const client = createStravaClient("expired");

    await expect(client.getActivities()).rejects.toThrow(
      "Strava API error 401: Authorization Error"
    );
  });

  it("throws on a 429 Too Many Requests (rate limit)", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(429, "Rate Limit Exceeded"));
    const client = createStravaClient("tok");

    await expect(client.getActivities()).rejects.toThrow(
      "Strava API error 429: Rate Limit Exceeded"
    );
  });

  it("throws on a 500 server error", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(500, "Internal Server Error"));
    const client = createStravaClient("tok");

    await expect(client.getActivities()).rejects.toThrow("Strava API error 500");
  });

  it("propagates a network-level fetch rejection", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const client = createStravaClient("tok");

    await expect(client.getActivities()).rejects.toThrow("fetch failed");
  });
});

// ===========================================================================
// createStravaClient — getActivity
// ===========================================================================

describe("createStravaClient.getActivity", () => {
  it("requests the activity by id and returns the detailed payload", async () => {
    const detailed = { ...sampleActivity, description: "felt good", calories: 700 };
    fetchMock.mockResolvedValueOnce(okJson(detailed));
    const client = createStravaClient("tok");

    const out = await client.getActivity(123);

    expect(out).toEqual(detailed);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/activities/123`, {
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("throws on a 404 for a missing/inaccessible activity", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(404, "Record Not Found"));
    const client = createStravaClient("tok");

    await expect(client.getActivity(999)).rejects.toThrow("Strava API error 404: Record Not Found");
  });

  it("propagates a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const client = createStravaClient("tok");

    await expect(client.getActivity(1)).rejects.toThrow("ECONNRESET");
  });
});

// ===========================================================================
// withTokenRefresh
// ===========================================================================

/** Seed the db select() result with one encrypted token row. */
function seedTokenRow(expiresAt: Date) {
  dbMock.setResult([
    {
      userId: "u1",
      accessTokenEnc: "enc-blob",
      refreshTokenEnc: "",
      iv: "iv-hex",
      authTag: "tag-hex",
      expiresAt,
    },
  ]);
}

function decryptedTokens(access: string, refresh: string) {
  cryptoMock.decrypt.mockReturnValue(
    JSON.stringify({ access_token: access, refresh_token: refresh })
  );
}

const refreshedTokens: RefreshTokenResponse = {
  token_type: "Bearer",
  access_token: "fresh-access",
  refresh_token: "fresh-refresh",
  expires_at: 4_000_000_000,
  expires_in: 21600,
};

describe("withTokenRefresh — valid (unexpired) token", () => {
  it("returns a client without refreshing when expiry is comfortably ahead", async () => {
    seedTokenRow(new Date(Date.now() + 3_600_000)); // +1h
    decryptedTokens("valid-access", "the-refresh");

    const client = await withTokenRefresh("u1");

    // No refresh, no write-back.
    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
    expect(dbMock.db.update).not.toHaveBeenCalled();
    expect(cryptoMock.encrypt).not.toHaveBeenCalled();

    // The returned client is bound to the decrypted access token.
    fetchMock.mockResolvedValueOnce(okJson([]));
    await client.getActivities();
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
      headers: { Authorization: "Bearer valid-access" },
    });
  });

  it("decrypts the stored blob with the row's iv and authTag", async () => {
    seedTokenRow(new Date(Date.now() + 3_600_000));
    decryptedTokens("valid-access", "the-refresh");

    await withTokenRefresh("u1");

    expect(cryptoMock.decrypt).toHaveBeenCalledWith("enc-blob", "iv-hex", "tag-hex");
    expect(dbMock.db.select).toHaveBeenCalledTimes(1);
    expect(dbMock.calls.limit?.[0]?.[0]).toBe(1);
  });

  it("treats a token 61s from expiry as still valid (boundary above 60s)", async () => {
    seedTokenRow(new Date(Date.now() + 61_000));
    decryptedTokens("valid-access", "the-refresh");

    await withTokenRefresh("u1");

    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
  });
});

describe("withTokenRefresh — expired token: refresh → persist → retry", () => {
  beforeEach(() => {
    cryptoMock.encrypt.mockReturnValue({
      iv: "new-iv",
      authTag: "new-tag",
      encrypted: "new-enc",
    });
    oauthMock.refreshAccessToken.mockResolvedValue(refreshedTokens);
  });

  it("refreshes using the decrypted refresh token when expired", async () => {
    seedTokenRow(new Date(Date.now() - 1000)); // already expired
    decryptedTokens("old-access", "old-refresh");

    await withTokenRefresh("u1");

    expect(oauthMock.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(oauthMock.refreshAccessToken).toHaveBeenCalledWith("old-refresh");
  });

  it("re-encrypts both tokens together as a single JSON blob", async () => {
    seedTokenRow(new Date(Date.now() - 1000));
    decryptedTokens("old-access", "old-refresh");

    await withTokenRefresh("u1");

    expect(cryptoMock.encrypt).toHaveBeenCalledTimes(1);
    expect(cryptoMock.encrypt).toHaveBeenCalledWith(
      JSON.stringify({
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
      })
    );
  });

  it("persists the new ciphertext, iv, authTag and expiry to the row", async () => {
    seedTokenRow(new Date(Date.now() - 1000));
    decryptedTokens("old-access", "old-refresh");

    await withTokenRefresh("u1");

    expect(dbMock.db.update).toHaveBeenCalledTimes(1);
    const setArg = dbMock.calls.set?.[0]?.[0];
    expect(setArg).toMatchObject({
      accessTokenEnc: "new-enc",
      refreshTokenEnc: "", // both tokens live in accessTokenEnc
      iv: "new-iv",
      authTag: "new-tag",
      expiresAt: new Date(refreshedTokens.expires_at * 1000),
    });
    expect(setArg.updatedAt).toBeInstanceOf(Date);
  });

  it("returns a client bound to the freshly refreshed access token", async () => {
    seedTokenRow(new Date(Date.now() - 1000));
    decryptedTokens("old-access", "old-refresh");

    const client = await withTokenRefresh("u1");

    fetchMock.mockResolvedValueOnce(okJson([sampleActivity]));
    const out = await client.getActivities();

    expect(out).toEqual([sampleActivity]);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
      headers: { Authorization: "Bearer fresh-access" },
    });
  });

  it("refreshes at exactly 60s from expiry (boundary not above 60s)", async () => {
    seedTokenRow(new Date(Date.now() + 60_000));
    decryptedTokens("old-access", "old-refresh");

    await withTokenRefresh("u1");

    expect(oauthMock.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("propagates a refresh failure and skips the write-back", async () => {
    seedTokenRow(new Date(Date.now() - 1000));
    decryptedTokens("old-access", "old-refresh");
    oauthMock.refreshAccessToken.mockRejectedValueOnce(
      new Error("Strava token refresh failed (400): invalid")
    );

    await expect(withTokenRefresh("u1")).rejects.toThrow("token refresh failed");
    expect(dbMock.db.update).not.toHaveBeenCalled();
    expect(cryptoMock.encrypt).not.toHaveBeenCalled();
  });
});

describe("withTokenRefresh — missing tokens", () => {
  it("throws when the user has no stored token row", async () => {
    dbMock.setResult([]); // no rows
    cryptoMock.decrypt.mockReturnValue("{}");

    await expect(withTokenRefresh("ghost")).rejects.toThrow(
      "No Strava tokens found for user ghost"
    );
    expect(cryptoMock.decrypt).not.toHaveBeenCalled();
    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("propagates a database error from the token lookup", async () => {
    dbMock.setError(new Error("connection refused"));

    await expect(withTokenRefresh("u1")).rejects.toThrow("connection refused");
  });
});
