import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for POST /api/strava/sync (issue #338).
 *
 * The route is the shell around lib/strava/sync.ts: auth, rate limit, and the
 * answer the client gets. The sync itself is mocked, so these tests pin down
 * the route's own contract:
 *   - it declares a duration that outlasts the sync's own deadline, so the
 *     platform does not cut a full historical sync off mid-page
 *   - it says "partial" when the history was not fully covered, instead of
 *     letting the client read "ok" as "your history is complete"
 *   - a sync that lost the race for the user lock is a conflict, not a crash
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rateLimit: vi.fn(),
  syncStravaActivities: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/observability", () => ({ captureError: mocks.captureError }));
vi.mock("@/lib/strava/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/strava/sync")>()),
  syncStravaActivities: mocks.syncStravaActivities,
}));

import { maxDuration, POST } from "@/app/api/strava/sync/route";
import { SYNC_DEADLINE_MS } from "@/lib/strava/sync";

function request(): NextRequest {
  return new Request("http://localhost/api/strava/sync", {
    method: "POST",
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 0, resetAt: Date.now() + 60_000 });
  mocks.syncStravaActivities.mockResolvedValue({ status: "complete", inserted: 42 });
});

describe("POST /api/strava/sync — duration", () => {
  it("declares a duration that outlasts the sync's own deadline", () => {
    // The platform cuts the function off at maxDuration (in seconds). If it
    // were shorter than the sync's deadline, a long history would be killed
    // before the sync could report that it was incomplete.
    expect(maxDuration * 1000).toBeGreaterThan(SYNC_DEADLINE_MS);
  });
});

describe("POST /api/strava/sync — answers", () => {
  it("reports a complete sync", async () => {
    const res = await POST(request());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, inserted: 42, partial: false });
    expect(mocks.syncStravaActivities).toHaveBeenCalledWith("user-1");
  });

  it("says the history was only partly synced", async () => {
    mocks.syncStravaActivities.mockResolvedValue({
      status: "partial",
      inserted: 100,
      reason: "paginationCap",
    });

    const res = await POST(request());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      inserted: 100,
      partial: true,
      reason: "paginationCap",
    });
  });

  it("refuses a second sync with a conflict instead of failing", async () => {
    mocks.syncStravaActivities.mockResolvedValue({ status: "busy", inserted: 0 });

    const res = await POST(request());

    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it("rejects an unauthenticated caller", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(mocks.syncStravaActivities).not.toHaveBeenCalled();
  });

  it("answers 429 when the sync ran recently", async () => {
    mocks.rateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    });

    const res = await POST(request());

    expect(res.status).toBe(429);
    expect(mocks.syncStravaActivities).not.toHaveBeenCalled();
  });

  it("hides the cause of a failed sync from the client", async () => {
    mocks.syncStravaActivities.mockRejectedValue(new Error("connection string leaked"));

    const res = await POST(request());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).not.toContain("connection string");
    expect(mocks.captureError).toHaveBeenCalledWith("strava-sync", expect.any(Error));
  });
});
