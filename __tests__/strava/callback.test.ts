import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the Strava OAuth callback route (issue #272).
 *
 * The state comparison must be timing-safe (`timingSafeStringEqual` from
 * lib/timing-safe.ts), but the route-level contract is what these tests pin
 * down: a state matching the one stored in the httpOnly cookie lets the flow
 * continue into `handleStravaCallback` with the cookie's PKCE verifier, while
 * any mismatch (or missing/malformed cookie) rejects the request, redirects
 * with `strava_error` and always clears the one-time-use cookie.
 *
 * `@/actions/strava` is mocked — the token exchange, encryption and DB writes
 * it performs are covered by their own suites.
 */

const { handleStravaCallback } = vi.hoisted(() => ({
  handleStravaCallback: vi.fn(),
}));

vi.mock("@/actions/strava", () => ({ handleStravaCallback }));

import { GET } from "@/app/api/strava/callback/route";

const STATE = "csrf-state-abc123";
const VERIFIER = "pkce-verifier-xyz789";

function callbackRequest({
  code = "auth-code-1",
  state = STATE,
  cookiePayload,
}: {
  code?: string | null;
  state?: string | null;
  cookiePayload?: unknown;
}): NextRequest {
  const params = new URLSearchParams();
  if (code !== null) params.set("code", code);
  if (state !== null) params.set("state", state);
  const headers: Record<string, string> = {};
  if (cookiePayload !== undefined) {
    headers.cookie = `strava_oauth=${encodeURIComponent(JSON.stringify(cookiePayload))}`;
  }
  return new NextRequest(`http://localhost/api/strava/callback?${params}`, { headers });
}

/** Does the redirect clear the one-time-use cookie? */
function clearsCookie(res: Response): boolean {
  const setCookie = res.headers.get("set-cookie") ?? "";
  return /strava_oauth=/.test(setCookie) && /max-age=0/i.test(setCookie);
}

beforeEach(() => {
  handleStravaCallback.mockReset().mockResolvedValue(undefined);
});

describe("GET /api/strava/callback — state verification", () => {
  it("continues into handleStravaCallback when the state matches", async () => {
    const res = await GET(callbackRequest({ cookiePayload: { v: VERIFIER, s: STATE } }));

    expect(handleStravaCallback).toHaveBeenCalledTimes(1);
    expect(handleStravaCallback).toHaveBeenCalledWith("auth-code-1", VERIFIER);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("strava_connected=true");
    expect(clearsCookie(res)).toBe(true);
  });

  it("rejects a wrong state without calling handleStravaCallback", async () => {
    const res = await GET(
      callbackRequest({ state: "forged-state", cookiePayload: { v: VERIFIER, s: STATE } })
    );

    expect(handleStravaCallback).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("strava_error=true");
    expect(clearsCookie(res)).toBe(true);
  });

  it("rejects when the cookie is missing entirely", async () => {
    const res = await GET(callbackRequest({ cookiePayload: undefined }));

    expect(handleStravaCallback).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("strava_error=true");
  });

  it("rejects a malformed cookie payload (invalid JSON)", async () => {
    const req = new NextRequest(`http://localhost/api/strava/callback?code=c&state=${STATE}`, {
      headers: { cookie: "strava_oauth=not-json-at-all" },
    });
    const res = await GET(req);

    expect(handleStravaCallback).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("strava_error=true");
    expect(clearsCookie(res)).toBe(true);
  });

  it("rejects a cookie payload without a state field", async () => {
    // `payload.s` is then undefined — the timing-safe compare must reject it
    // (unequal byte lengths), not throw past the route's error handling.
    const res = await GET(callbackRequest({ cookiePayload: { v: VERIFIER } }));

    expect(handleStravaCallback).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("strava_error=true");
  });

  it("redirects with an error when code or state are missing", async () => {
    const noCode = await GET(
      callbackRequest({ code: null, cookiePayload: { v: VERIFIER, s: STATE } })
    );
    const noState = await GET(
      callbackRequest({ state: null, cookiePayload: { v: VERIFIER, s: STATE } })
    );

    expect(noCode.headers.get("location")).toContain("strava_error=true");
    expect(noState.headers.get("location")).toContain("strava_error=true");
    expect(handleStravaCallback).not.toHaveBeenCalled();
  });

  it("redirects with an error (and clears the cookie) when the exchange fails", async () => {
    handleStravaCallback.mockRejectedValue(new Error("Strava token exchange failed (400)"));
    const res = await GET(callbackRequest({ cookiePayload: { v: VERIFIER, s: STATE } }));

    expect(handleStravaCallback).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toContain("strava_error=true");
    expect(clearsCookie(res)).toBe(true);
  });
});
