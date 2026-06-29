import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for lib/strava/oauth.ts.
 *
 * The module under test exposes four pure-ish helpers around Strava's
 * PKCE OAuth flow:
 *   - generatePkce()                         → { codeVerifier, codeChallenge }
 *   - getAuthorizationUrl(challenge, state)  → authorize URL string
 *   - exchangeCodeForTokens(code, verifier)  → POST /oauth/token (auth code grant)
 *   - refreshAccessToken(refreshToken)       → POST /oauth/token (refresh grant)
 *
 * Externals that are mocked / controlled:
 *   - global fetch (the Strava token endpoint)
 *   - the STRAVA_* environment variables (read via a getEnv() guard)
 *
 * PKCE crypto is intentionally NOT mocked — we verify the real S256
 * (SHA-256 → base64url) relationship between verifier and challenge.
 */

import {
  exchangeCodeForTokens,
  generatePkce,
  getAuthorizationUrl,
  refreshAccessToken,
} from "@/lib/strava/oauth";
import type { RefreshTokenResponse, StravaTokensResponse } from "@/lib/strava/types";

const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";

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
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("STRAVA_CLIENT_ID", "12345");
  vi.stubEnv("STRAVA_CLIENT_SECRET", "super-secret");
  vi.stubEnv("STRAVA_REDIRECT_URI", "https://stride.app/api/strava/callback");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// Realistic token fixtures (field names mirror the Strava API exactly).
const tokensFixture: StravaTokensResponse = {
  token_type: "Bearer",
  expires_at: 4_000_000_000,
  expires_in: 21_600,
  refresh_token: "refresh-token-abc",
  access_token: "access-token-xyz",
  athlete: {
    id: 42,
    username: "runner",
    firstname: "Sam",
    lastname: "Speed",
    city: "Copenhagen",
    state: null,
    country: "Denmark",
    sex: "M",
    profile_medium: null,
    profile: null,
  },
};

const refreshFixture: RefreshTokenResponse = {
  token_type: "Bearer",
  access_token: "fresh-access",
  expires_at: 4_100_000_000,
  expires_in: 21_600,
  refresh_token: "fresh-refresh",
};

// ===========================================================================
// generatePkce
// ===========================================================================

describe("generatePkce", () => {
  it("returns both a code verifier and a code challenge", () => {
    const { codeVerifier, codeChallenge } = generatePkce();

    expect(typeof codeVerifier).toBe("string");
    expect(typeof codeChallenge).toBe("string");
    expect(codeVerifier.length).toBeGreaterThan(0);
    expect(codeChallenge.length).toBeGreaterThan(0);
  });

  it("derives the challenge as the base64url SHA-256 of the verifier (S256)", () => {
    const { codeVerifier, codeChallenge } = generatePkce();

    const expected = createHash("sha256").update(codeVerifier).digest("base64url");
    expect(codeChallenge).toBe(expected);
  });

  it("emits URL-safe base64url strings with no padding for both values", () => {
    const { codeVerifier, codeChallenge } = generatePkce();

    // base64url alphabet only: A-Z a-z 0-9 - _ and no '=' padding, no '+' or '/'.
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a 43-char challenge (SHA-256 → 32 bytes → base64url)", () => {
    const { codeChallenge } = generatePkce();

    // 32 bytes base64url-encodes to 43 chars (256 bits, no padding).
    expect(codeChallenge).toHaveLength(43);
  });

  it("generates a fresh, unpredictable verifier on each call", () => {
    const a = generatePkce();
    const b = generatePkce();

    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });
});

// ===========================================================================
// getAuthorizationUrl
// ===========================================================================

describe("getAuthorizationUrl", () => {
  it("builds a URL against the Strava authorize endpoint", () => {
    const url = getAuthorizationUrl("challenge-123", "state-xyz");

    expect(url.startsWith(`${STRAVA_AUTH_URL}?`)).toBe(true);
  });

  it("includes every required OAuth + PKCE parameter", () => {
    const url = getAuthorizationUrl("challenge-123", "state-xyz");
    const params = new URL(url).searchParams;

    expect(params.get("client_id")).toBe("12345");
    expect(params.get("redirect_uri")).toBe("https://stride.app/api/strava/callback");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("approval_prompt")).toBe("auto");
    expect(params.get("scope")).toBe("read,activity:read_all");
    expect(params.get("code_challenge")).toBe("challenge-123");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toBe("state-xyz");
  });

  it("requests the activity:read_all scope (needed for private activities)", () => {
    const params = new URL(getAuthorizationUrl("c", "s")).searchParams;

    expect(params.get("scope")).toContain("activity:read_all");
  });

  it("URL-encodes the challenge and state into the query string", () => {
    const url = getAuthorizationUrl("a+b/c=d", "x y&z");
    const params = new URL(url).searchParams;

    // Round-trips back to the originals after decoding.
    expect(params.get("code_challenge")).toBe("a+b/c=d");
    expect(params.get("state")).toBe("x y&z");
    // And the raw string is percent-encoded, not literal.
    expect(url).not.toContain("x y&z");
  });

  it("throws when STRAVA_CLIENT_ID is missing", () => {
    vi.stubEnv("STRAVA_CLIENT_ID", "");

    expect(() => getAuthorizationUrl("c", "s")).toThrow(
      "Missing environment variable: STRAVA_CLIENT_ID"
    );
  });

  it("throws when STRAVA_REDIRECT_URI is missing", () => {
    vi.stubEnv("STRAVA_REDIRECT_URI", "");

    expect(() => getAuthorizationUrl("c", "s")).toThrow(
      "Missing environment variable: STRAVA_REDIRECT_URI"
    );
  });
});

// ===========================================================================
// exchangeCodeForTokens
// ===========================================================================

describe("exchangeCodeForTokens", () => {
  it("POSTs the authorization_code grant to the token endpoint", async () => {
    fetchMock.mockResolvedValueOnce(okJson(tokensFixture));

    await exchangeCodeForTokens("auth-code-1", "verifier-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(STRAVA_TOKEN_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("sends client credentials, code, verifier and grant_type in the body", async () => {
    fetchMock.mockResolvedValueOnce(okJson(tokensFixture));

    await exchangeCodeForTokens("auth-code-1", "verifier-1");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      client_id: "12345",
      client_secret: "super-secret",
      code: "auth-code-1",
      grant_type: "authorization_code",
      code_verifier: "verifier-1",
    });
  });

  it("returns the parsed access + refresh tokens on success", async () => {
    fetchMock.mockResolvedValueOnce(okJson(tokensFixture));

    const tokens = await exchangeCodeForTokens("auth-code-1", "verifier-1");

    expect(tokens).toEqual(tokensFixture);
    expect(tokens.access_token).toBe("access-token-xyz");
    expect(tokens.refresh_token).toBe("refresh-token-abc");
  });

  it("throws with status and body when Strava rejects an invalid code (400)", async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(400, '{"message":"Bad Request","errors":[{"code":"invalid"}]}')
    );

    await expect(exchangeCodeForTokens("bad-code", "verifier-1")).rejects.toThrow(
      'Strava token exchange failed (400): {"message":"Bad Request","errors":[{"code":"invalid"}]}'
    );
  });

  it("throws on a 401 Unauthorized (bad client credentials)", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(401, "Authorization Error"));

    await expect(exchangeCodeForTokens("code", "verifier")).rejects.toThrow(
      "Strava token exchange failed (401): Authorization Error"
    );
  });

  it("throws on a 500 server error", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(500, "Internal Server Error"));

    await expect(exchangeCodeForTokens("code", "verifier")).rejects.toThrow(
      "Strava token exchange failed (500)"
    );
  });

  it("does not parse the JSON body on a non-ok response", async () => {
    const resp = errResponse(400, "nope");
    const jsonSpy = vi.spyOn(resp, "json");
    fetchMock.mockResolvedValueOnce(resp);

    await expect(exchangeCodeForTokens("code", "verifier")).rejects.toThrow();
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("propagates a network-level fetch rejection", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(exchangeCodeForTokens("code", "verifier")).rejects.toThrow("fetch failed");
  });

  it("throws when STRAVA_CLIENT_SECRET is missing (before fetching)", async () => {
    vi.stubEnv("STRAVA_CLIENT_SECRET", "");

    await expect(exchangeCodeForTokens("code", "verifier")).rejects.toThrow(
      "Missing environment variable: STRAVA_CLIENT_SECRET"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// refreshAccessToken
// ===========================================================================

describe("refreshAccessToken", () => {
  it("POSTs the refresh_token grant to the token endpoint", async () => {
    fetchMock.mockResolvedValueOnce(okJson(refreshFixture));

    await refreshAccessToken("refresh-token-abc");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(STRAVA_TOKEN_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("sends client credentials, refresh_token and grant_type in the body", async () => {
    fetchMock.mockResolvedValueOnce(okJson(refreshFixture));

    await refreshAccessToken("refresh-token-abc");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      client_id: "12345",
      client_secret: "super-secret",
      grant_type: "refresh_token",
      refresh_token: "refresh-token-abc",
    });
    // A refresh must never leak the PKCE verifier or an auth code.
    expect(body).not.toHaveProperty("code");
    expect(body).not.toHaveProperty("code_verifier");
  });

  it("returns a brand-new access token on success", async () => {
    fetchMock.mockResolvedValueOnce(okJson(refreshFixture));

    const refreshed = await refreshAccessToken("refresh-token-abc");

    expect(refreshed).toEqual(refreshFixture);
    expect(refreshed.access_token).toBe("fresh-access");
    expect(refreshed.refresh_token).toBe("fresh-refresh");
  });

  it("throws with status and body when the refresh token is expired/invalid (400)", async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(400, '{"message":"Bad Request","errors":[{"field":"refresh_token"}]}')
    );

    await expect(refreshAccessToken("expired-token")).rejects.toThrow(
      'Strava token refresh failed (400): {"message":"Bad Request","errors":[{"field":"refresh_token"}]}'
    );
  });

  it("throws on a 401 Unauthorized", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(401, "Authorization Error"));

    await expect(refreshAccessToken("token")).rejects.toThrow(
      "Strava token refresh failed (401): Authorization Error"
    );
  });

  it("throws on a 429 rate-limit response", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(429, "Rate Limit Exceeded"));

    await expect(refreshAccessToken("token")).rejects.toThrow(
      "Strava token refresh failed (429): Rate Limit Exceeded"
    );
  });

  it("propagates a network-level fetch rejection", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));

    await expect(refreshAccessToken("token")).rejects.toThrow("ECONNRESET");
  });

  it("throws when STRAVA_CLIENT_ID is missing (before fetching)", async () => {
    vi.stubEnv("STRAVA_CLIENT_ID", "");

    await expect(refreshAccessToken("token")).rejects.toThrow(
      "Missing environment variable: STRAVA_CLIENT_ID"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
