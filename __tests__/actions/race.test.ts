import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for actions/race.ts (issue #99).
 *
 * saveRacePlan is a session-gated RPC: auth() → zod validation (well-formed,
 * possible calendar day, today ≤ date ≤ +2 years) → updateRacePlan →
 * revalidateProgression. Everything it reaches out to is mocked; the date
 * validation runs against the real engine's getLocalDate, pinned via fake
 * timers so "today" is deterministic in any timezone.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  updateRacePlan: vi.fn(),
  revalidateProgression: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db/queries", () => ({
  updateRacePlan: mocks.updateRacePlan,
}));

vi.mock("@/lib/coach/dashboard-data", () => ({
  revalidateProgression: mocks.revalidateProgression,
}));

import { saveRacePlan } from "@/actions/race";

// 12:00 UTC = 14:00 in Copenhagen — the Danish calendar day is 11 Jul 2026
// whatever timezone the test machine runs in.
const NOW = new Date(Date.UTC(2026, 6, 11, 12, 0, 0));

describe("saveRacePlan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.auth.mockReset().mockResolvedValue({ user: { id: "user-1" } });
    mocks.updateRacePlan.mockReset().mockResolvedValue({ id: "user-1" });
    mocks.revalidateProgression.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects an unauthenticated caller without touching the DB", async () => {
    mocks.auth.mockResolvedValue(null);
    const result = await saveRacePlan({ raceDate: "2026-10-04" });
    expect(result.ok).toBe(false);
    expect(mocks.updateRacePlan).not.toHaveBeenCalled();
    expect(mocks.revalidateProgression).not.toHaveBeenCalled();
  });

  it("persists a valid race and hard-expires the progression cache", async () => {
    const result = await saveRacePlan({ raceDate: "2027-10-10", raceName: "CPH Half" });
    expect(result).toEqual({ ok: true });
    expect(mocks.updateRacePlan).toHaveBeenCalledWith("user-1", {
      raceDate: new Date(2027, 9, 10),
      raceName: "CPH Half",
    });
    expect(mocks.revalidateProgression).toHaveBeenCalledOnce();
  });

  it("stores null when no race name is given", async () => {
    await saveRacePlan({ raceDate: "2027-10-10" });
    expect(mocks.updateRacePlan).toHaveBeenCalledWith("user-1", {
      raceDate: new Date(2027, 9, 10),
      raceName: null,
    });
  });

  it("rejects a malformed date string", async () => {
    for (const raceDate of ["10-10-2027", "2027/10/10", "not-a-date", ""]) {
      const result = await saveRacePlan({ raceDate });
      expect(result.ok, raceDate).toBe(false);
    }
    expect(mocks.updateRacePlan).not.toHaveBeenCalled();
  });

  it("rejects a regex-valid but impossible calendar day", async () => {
    const result = await saveRacePlan({ raceDate: "2027-02-31" });
    expect(result.ok).toBe(false);
    expect(mocks.updateRacePlan).not.toHaveBeenCalled();
  });

  it("rejects a race date in the past (zod/bounds guard)", async () => {
    const result = await saveRacePlan({ raceDate: "2026-07-10" }); // yesterday
    expect(result.ok).toBe(false);
    expect(mocks.updateRacePlan).not.toHaveBeenCalled();
  });

  it("accepts race day today — the boundary is inclusive", async () => {
    const result = await saveRacePlan({ raceDate: "2026-07-11" });
    expect(result).toEqual({ ok: true });
  });

  it("caps the horizon at 2 years, inclusive", async () => {
    expect((await saveRacePlan({ raceDate: "2028-07-11" })).ok).toBe(true);
    expect((await saveRacePlan({ raceDate: "2028-07-12" })).ok).toBe(false);
  });

  it("rejects an empty or over-long race name", async () => {
    expect((await saveRacePlan({ raceDate: "2027-10-10", raceName: "  " })).ok).toBe(false);
    expect((await saveRacePlan({ raceDate: "2027-10-10", raceName: "x".repeat(81) })).ok).toBe(
      false
    );
  });
});
