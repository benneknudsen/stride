import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exchangeCodeForTokens,
  expiresAtFrom,
  generatePkce,
  getAuthorizationUrl,
  refreshAccessToken,
} from "@/lib/garmin/oauth";

/**
 * Issue #35. The load-bearing difference from the Strava OAuth path: Garmin's
 * token endpoint takes `application/x-www-form-urlencoded` and rejects a JSON
 * body, and it reports a *relative* `expires_in` where Strava reports an
 * absolute `expires_at`. Both are pinned here.
 */

const TOKENS = {
  access_token: "at-1",
  refresh_token: "rt-1",
  token_type: "Bearer",
  expires_in: 86_400,
  refresh_token_expires_in: 7_776_000,
  scope: "activity:read",
};

beforeEach(() => {
  vi.stubEnv("GARMIN_CLIENT_ID", "client-123");
  vi.stubEnv("GARMIN_CLIENT_SECRET", "secret-456");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => TOKENS,
    text: async () => "",
    ...response,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("generatePkce", () => {
  it("derives the challenge as the base64url S256 hash of the verifier", () => {
    const { codeVerifier, codeChallenge } = generatePkce();
    const expected = createHash("sha256").update(codeVerifier).digest("base64url");
    expect(codeChallenge).toBe(expected);
  });

  it("mints a fresh verifier per call", () => {
    expect(generatePkce().codeVerifier).not.toBe(generatePkce().codeVerifier);
  });
});

describe("getAuthorizationUrl", () => {
  it("carries the S256 challenge, the state and the client id", () => {
    const url = new URL(getAuthorizationUrl("challenge-1", "state-1", "https://app.test/cb"));
    expect(url.origin + url.pathname).toBe("https://connect.garmin.com/oauth2Confirm");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/cb");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("throws a named error rather than redirecting with an empty client id", () => {
    vi.stubEnv("GARMIN_CLIENT_ID", "");
    expect(() => getAuthorizationUrl("c", "s", "https://app.test/cb")).toThrow(/GARMIN_CLIENT_ID/);
  });
});

describe("exchangeCodeForTokens", () => {
  it("posts a form-encoded authorization_code grant with the PKCE verifier", async () => {
    const fetchMock = mockFetch({});

    const tokens = await exchangeCodeForTokens("code-1", "verifier-1", "https://app.test/cb");

    expect(tokens).toEqual(TOKENS);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://diauth.garmin.com/di-oauth2-service/oauth/token");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    // A JSON body here is a 400 from Garmin — assert the body really is a form.
    const body = init.body as URLSearchParams;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("code_verifier")).toBe("verifier-1");
    expect(body.get("client_id")).toBe("client-123");
    expect(body.get("client_secret")).toBe("secret-456");
    expect(body.get("redirect_uri")).toBe("https://app.test/cb");
  });

  it("throws with the upstream status on a rejected exchange", async () => {
    mockFetch({ ok: false, status: 400, text: async () => "invalid_grant" });
    await expect(exchangeCodeForTokens("bad", "v", "https://app.test/cb")).rejects.toThrow(
      /token exchange failed \(400\): invalid_grant/
    );
  });
});

describe("refreshAccessToken", () => {
  it("posts a form-encoded refresh_token grant", async () => {
    const fetchMock = mockFetch({});

    await refreshAccessToken("rt-0");

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-0");
    expect(body.get("client_secret")).toBe("secret-456");
    // No PKCE verifier on a refresh — it is not an authorization-code grant.
    expect(body.get("code_verifier")).toBeNull();
  });

  it("throws on an expired refresh token", async () => {
    mockFetch({ ok: false, status: 401, text: async () => "expired" });
    await expect(refreshAccessToken("dead")).rejects.toThrow(/token refresh failed \(401\)/);
  });
});

describe("expiresAtFrom", () => {
  it("turns Garmin's relative expires_in into an absolute instant", () => {
    const now = Date.parse("2026-07-12T10:00:00.000Z");
    expect(expiresAtFrom(TOKENS, now).toISOString()).toBe("2026-07-13T10:00:00.000Z");
  });
});
