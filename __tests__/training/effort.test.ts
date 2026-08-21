import { describe, expect, it } from "vitest";
import {
  type ActivityInput,
  dominantZone,
  HARD_EFFORT_LOOKBACK_HOURS,
  hoursSinceHardEffort,
  isHardEffort,
} from "@/lib/training/effort";

/**
 * The shared hard-effort classifier (issue #259) — the one answer to "was that
 * a hard run, and how long ago?" that both the "Næste aktivitet" variation and
 * the Form-status readiness cap read.
 *
 * Zones follow the default 190 bpm max: Z4 starts at 152 bpm (80 %), Z5 at
 * 171 bpm (90 %).
 */

const NOW = new Date(2026, 6, 15, 9, 0);

/** A run `hoursAgo` before NOW at the given average heart rate. */
function run(hoursAgo: number, hr: number | null, movingTime = 2_400): ActivityInput {
  return {
    startDate: new Date(NOW.getTime() - hoursAgo * 3_600_000),
    averageHeartrate: hr,
    movingTime,
  };
}

describe("isHardEffort", () => {
  it.each([
    [110, 1], // 58 % of the 190 default max
    [125, 2], // 66 %
    [140, 3], // 74 %
    [155, 4], // 82 % — tærskel
    [175, 5], // 92 %
  ] as const)("reads %d bpm as zone %d", (hr, zone) => {
    expect(dominantZone(run(1, hr))).toBe(zone);
  });

  it("counts Zone 4 and Zone 5 as hard", () => {
    expect(isHardEffort(run(1, 155))).toBe(true); // tærskel
    expect(isHardEffort(run(1, 180))).toBe(true); // VO2 max
  });

  it("does not count tempo or easy as hard", () => {
    expect(isHardEffort(run(1, 148))).toBe(false); // Z3 tempo
    expect(isHardEffort(run(1, 125))).toBe(false); // Z2
    expect(isHardEffort(run(1, 110))).toBe(false); // Z1
  });

  it("reads a run without heart rate as not hard rather than inventing an intensity", () => {
    expect(dominantZone(run(1, null))).toBeNull();
    expect(isHardEffort(run(1, null))).toBe(false);
    expect(isHardEffort(run(1, 0))).toBe(false);
  });

  it("prefers Strava's zone buckets over the average-heart-rate fallback", () => {
    // The issue's own case: a 35-minute tur, 62 % tærskel — hard, even though
    // the *average* pulse of 153 alone would only just reach Z4.
    const zoneWeighted: ActivityInput = {
      startDate: NOW,
      averageHeartrate: 153,
      movingTime: 2_100,
      hrZones: [
        { zone: 3, seconds: 378, min: 133, max: 151 },
        { zone: 4, seconds: 1_302, min: 152, max: 170 },
        { zone: 5, seconds: 420, min: 171, max: null },
      ],
    };
    expect(dominantZone(zoneWeighted)).toBe(4);
    expect(isHardEffort(zoneWeighted)).toBe(true);

    // …and a bucketed easy run stays easy however its average reads.
    const easyBuckets: ActivityInput = {
      startDate: NOW,
      averageHeartrate: 175,
      movingTime: 2_100,
      hrZones: [{ zone: 2, seconds: 2_100, min: 114, max: 132 }],
    };
    expect(isHardEffort(easyBuckets)).toBe(false);
  });
});

describe("hoursSinceHardEffort", () => {
  it("reads an empty history as null (cold start)", () => {
    expect(hoursSinceHardEffort([], NOW)).toBeNull();
  });

  it("reads a history without heart rate as null", () => {
    expect(hoursSinceHardEffort([run(4, null), run(30, null)], NOW)).toBeNull();
  });

  it("reads a history of easy runs only as null", () => {
    expect(hoursSinceHardEffort([run(4, 138), run(30, 142), run(54, 130)], NOW)).toBeNull();
  });

  it("returns the hours since a single hard effort", () => {
    expect(hoursSinceHardEffort([run(6, 172)], NOW)).toBeCloseTo(6);
  });

  it("returns the newest hard effort, not the first one it meets in input order", () => {
    // Deliberately unsorted, oldest first — the scan must order the runs itself.
    const runs = [run(70, 175), run(30, 138), run(5, 168), run(50, 174)];
    expect(hoursSinceHardEffort(runs, NOW)).toBeCloseTo(5);
  });

  it("skips easy runs newer than the hard one", () => {
    const runs = [run(2, 132), run(10, 140), run(28, 174)];
    expect(hoursSinceHardEffort(runs, NOW)).toBeCloseTo(28);
  });

  it("ignores hard efforts older than the lookback window", () => {
    expect(hoursSinceHardEffort([run(HARD_EFFORT_LOOKBACK_HOURS + 1, 175)], NOW)).toBeNull();
    expect(hoursSinceHardEffort([run(HARD_EFFORT_LOOKBACK_HOURS - 1, 175)], NOW)).toBeCloseTo(
      HARD_EFFORT_LOOKBACK_HOURS - 1
    );
  });

  it("ignores runs in the future rather than returning negative hours", () => {
    expect(hoursSinceHardEffort([run(-5, 175)], NOW)).toBeNull();
    expect(hoursSinceHardEffort([run(-5, 175), run(9, 174)], NOW)).toBeCloseTo(9);
  });

  it("accepts the ISO-string startDate the Neon driver returns (issue #194)", () => {
    const iso = new Date(NOW.getTime() - 12 * 3_600_000).toISOString();
    expect(
      hoursSinceHardEffort([{ startDate: iso, averageHeartrate: 175, movingTime: 2_400 }], NOW)
    ).toBeCloseTo(12);
  });

  it("is deterministic — same input, same answer", () => {
    const runs = [run(3, 174), run(20, 140)];
    expect(hoursSinceHardEffort(runs, NOW)).toBe(hoursSinceHardEffort(runs, NOW));
  });
});
