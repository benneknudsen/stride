import { describe, expect, it } from "vitest";
import {
  formatPaceClock,
  formatRaceTime,
  inferRaceDistanceMeters,
  type PredictionActivity,
  predictRace,
} from "../../lib/training/prediction";

const AS_OF = new Date("2026-07-01T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_M = 21_097.5;

function daysAgo(days: number): Date {
  return new Date(AS_OF.getTime() - days * DAY_MS);
}

/** A run `km` long at `paceMinPerKm`, `days` before AS_OF. */
function run(days: number, km: number, paceMinPerKm: number, type = "Run"): PredictionActivity {
  return {
    type,
    distance: km * 1000,
    movingTime: Math.round(km * paceMinPerKm * 60),
    startDate: daysAgo(days),
  };
}

describe("inferRaceDistanceMeters", () => {
  it("reads a half marathon before matching the substring 'marathon'", () => {
    expect(inferRaceDistanceMeters("Silkeborg Halvmarathon")).toBe(HALF_M);
    expect(inferRaceDistanceMeters("Copenhagen Half Marathon")).toBe(HALF_M);
  });

  it("reads a full marathon (English and Danish spelling)", () => {
    expect(inferRaceDistanceMeters("Berlin Marathon")).toBe(42_195);
    expect(inferRaceDistanceMeters("København Maraton")).toBe(42_195);
  });

  it("reads a bare distance like 10K or '5 km'", () => {
    expect(inferRaceDistanceMeters("Eremitageløbet 10K")).toBe(10_000);
    expect(inferRaceDistanceMeters("Park 5 km")).toBe(5000);
  });

  it("defaults to a half marathon for an unrecognised or empty name", () => {
    expect(inferRaceDistanceMeters("Some Fun Run")).toBe(HALF_M);
    expect(inferRaceDistanceMeters(undefined)).toBe(HALF_M);
    expect(inferRaceDistanceMeters(null)).toBe(HALF_M);
  });
});

describe("predictRace", () => {
  it("applies Riegel's formula: T2 = T1 × (D2/D1)^1.06", () => {
    // A single 10 km effort at 5:00/km → 3000 s. Project to the half.
    const prediction = predictRace([run(3, 10, 5)], HALF_M, AS_OF);
    const expected = 3000 * (HALF_M / 10_000) ** 1.06;
    expect(prediction).not.toBeNull();
    expect(prediction?.predictedSeconds).toBe(Math.round(expected));
    // Derived pace agrees with the finish over the target distance.
    expect(prediction?.racePaceSecPerKm).toBe(
      Math.round((prediction as { predictedSeconds: number }).predictedSeconds / (HALF_M / 1000))
    );
  });

  it("returns null when no effort is long enough to project from", () => {
    // The half's basis floor is 0.25 × 21.1 ≈ 5.3 km; a pile of 4 km runs can't set it.
    expect(predictRace([run(2, 4, 4.5), run(4, 4, 4.6)], HALF_M, AS_OF)).toBeNull();
    expect(predictRace([], HALF_M, AS_OF)).toBeNull();
  });

  it("returns null for a non-positive target distance", () => {
    expect(predictRace([run(3, 10, 5)], 0, AS_OF)).toBeNull();
  });

  it("picks the fastest projection as the runner's potential", () => {
    // The 10 km @ 4:30 projects faster than the 18 km @ 5:30 easy long run.
    const prediction = predictRace([run(3, 18, 5.5), run(5, 10, 4.5)], HALF_M, AS_OF);
    expect(prediction?.basis.distanceKm).toBe(10);
    expect(prediction?.basis.paceSecPerKm).toBe(270);
  });

  it("ignores non-run activity types", () => {
    const prediction = predictRace([run(3, 40, 3, "Ride"), run(4, 10, 5)], HALF_M, AS_OF);
    // The fast 40 km ride is dropped; only the 10 km run remains as basis.
    expect(prediction?.basis.distanceKm).toBe(10);
  });

  it("prefers recent form but falls back to older history when the window is empty", () => {
    // Only effort is 90 days old — outside the 42-day window, still used as fallback.
    const prediction = predictRace([run(90, 12, 5)], HALF_M, AS_OF);
    expect(prediction).not.toBeNull();
    expect(prediction?.basis.daysAgo).toBe(90);
  });

  it("excludes efforts dated after `now`", () => {
    const future: PredictionActivity = {
      type: "Run",
      distance: 15_000,
      movingTime: 15_000 * 0.24, // absurdly fast, would win if counted
      startDate: new Date(AS_OF.getTime() + DAY_MS),
    };
    const prediction = predictRace([future, run(3, 10, 5)], HALF_M, AS_OF);
    expect(prediction?.basis.distanceKm).toBe(10);
  });

  it("rounds the goal up to a clean 5-minute target the estimate can beat", () => {
    const prediction = predictRace([run(3, 10, 5)], HALF_M, AS_OF);
    expect(prediction).not.toBeNull();
    const p = prediction as NonNullable<typeof prediction>;
    expect(p.goalSeconds % 300).toBe(0);
    expect(p.goalSeconds).toBeGreaterThanOrEqual(p.predictedSeconds);
    expect(p.goalSeconds - p.predictedSeconds).toBeLessThan(300);
  });

  it("grades confidence high with a near-race-distance basis and a deep sample", () => {
    // Six 18 km efforts (18/21.1 ≈ 0.85 ≥ 0.5) over the last six weeks.
    const runs = [3, 8, 13, 20, 27, 34].map((d) => run(d, 18, 5.2));
    expect(predictRace(runs, HALF_M, AS_OF)?.confidence).toBe("high");
  });

  it("grades confidence low from a single short-relative effort", () => {
    // One 6 km run (6/21.1 ≈ 0.28 < 0.3) projected to a half.
    expect(predictRace([run(3, 6, 4.6)], HALF_M, AS_OF)?.confidence).toBe("low");
  });
});

describe("formatRaceTime", () => {
  it("renders H:MM once the time reaches an hour", () => {
    expect(formatRaceTime(3600 + 45 * 60 + 30)).toBe("1:45");
    expect(formatRaceTime(2 * 3600 + 5 * 60)).toBe("2:05");
  });

  it("renders M:SS under an hour (a fast 5 km stays legible)", () => {
    expect(formatRaceTime(19 * 60 + 34)).toBe("19:34");
    expect(formatRaceTime(0)).toBe("0:00");
  });
});

describe("formatPaceClock", () => {
  it("renders seconds-per-km as M:SS", () => {
    expect(formatPaceClock(286)).toBe("4:46");
    expect(formatPaceClock(300)).toBe("5:00");
    expect(formatPaceClock(65)).toBe("1:05");
  });
});
