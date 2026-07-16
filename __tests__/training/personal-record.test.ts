import { describe, expect, it } from "vitest";
import { detectPersonalRecord, type RecordActivityLike } from "@/lib/training/personal-record";

/** A run described by distance (km) and pace (min/km) — the readable form. */
function run(km: number, paceMinPerKm: number): RecordActivityLike {
  return { distance: km * 1000, movingTime: km * paceMinPerKm * 60 };
}

describe("detectPersonalRecord (#122)", () => {
  it("detects a fastest 5k against prior runs in the band", () => {
    expect(detectPersonalRecord(run(5.0, 4.25), [run(5.2, 5.0), run(10, 4.0)])).toBe("5k");
  });

  it("is no PR when a prior 5k-band run was faster", () => {
    expect(detectPersonalRecord(run(5.0, 4.5), [run(4.8, 4.4), run(8, 6.0)])).toBeNull();
  });

  it("compares within ±0.5 km — a fast 6k doesn't block the 5k record", () => {
    expect(detectPersonalRecord(run(5.0, 4.5), [run(6.0, 4.0), run(5.5, 5.0)])).toBe("5k");
  });

  it("a band's first-ever run is not a record", () => {
    // History has nothing near 5k (and a longer run, so 'longest' can't fire).
    expect(detectPersonalRecord(run(5.0, 4.0), [run(8.0, 5.5)])).toBeNull();
  });

  it("detects a fastest 10k", () => {
    expect(detectPersonalRecord(run(10.2, 4.4), [run(9.8, 4.5), run(21.1, 5.2)])).toBe("10k");
  });

  it("detects a fastest halvmarathon within ±1 km", () => {
    expect(detectPersonalRecord(run(20.5, 5.0), [run(21.5, 5.3), run(22.0, 5.2)])).toBe("half");
  });

  it("a 19.9 km run is outside the halvmarathon band", () => {
    expect(detectPersonalRecord(run(19.9, 4.8), [run(21.1, 5.3)])).toBeNull();
  });

  it("detects the longest run ever, regardless of pace", () => {
    expect(detectPersonalRecord(run(25.0, 6.2), [run(24.0, 5.4), run(10.0, 4.5)])).toBe("longest");
  });

  it("longest requires strictly farther — matching the old max is no record", () => {
    expect(detectPersonalRecord(run(24.0, 5.0), [run(24.0, 5.4)])).toBeNull();
  });

  it("prefers the pace band over 'longest' when a run sets both", () => {
    expect(detectPersonalRecord(run(21.1, 5.0), [run(20.5, 5.5), run(15, 5.0)])).toBe("half");
  });

  it("returns null with no history at all", () => {
    expect(detectPersonalRecord(run(5.0, 4.0), [])).toBeNull();
  });

  it("ignores runs without usable distance/time", () => {
    expect(detectPersonalRecord({ distance: 0, movingTime: 0 }, [run(5, 5)])).toBeNull();
    expect(detectPersonalRecord(run(5.0, 4.5), [{ distance: 5000, movingTime: 0 }])).toBeNull();
  });
});
