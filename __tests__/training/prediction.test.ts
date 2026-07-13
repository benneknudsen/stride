import { describe, expect, it } from "vitest";
import {
  formatPaceClock,
  formatPaceRange,
  formatRaceTime,
  goalTimeFor,
  HALF_MARATHON_KM,
  PACE_ZONE_SPEED_FRACTION,
  type PaceZone,
  type PredictionActivity,
  predictRace,
  zonePaceSeconds,
  zonePaces,
} from "@/lib/training/prediction";

// The race predictor (issue #115) — the engine the plan's pace targets derive
// from. Everything here is pure: `now` is injected, so no test depends on the
// wall clock.

const NOW = new Date(2026, 6, 8, 9, 0); // Wed 8 Jul 2026
const DAY_MS = 86_400_000;

function run(daysAgo: number, km: number, paceSecPerKm: number, type = "Run"): PredictionActivity {
  return {
    type,
    distance: km * 1000,
    movingTime: Math.round(km * paceSecPerKm),
    startDate: new Date(NOW.getTime() - daysAgo * DAY_MS),
  };
}

describe("predictRace", () => {
  it("extrapolates a race time from a recent effort via Riegel", () => {
    // A 10 km at 4:30/km → half marathon a touch slower per km, never faster.
    const prediction = predictRace([run(3, 10, 270)], NOW);
    expect(prediction).not.toBeNull();
    expect(prediction?.raceDistanceKm).toBe(HALF_MARATHON_KM);
    expect(prediction?.paceSecPerKm).toBeGreaterThan(270);
    expect(prediction?.timeSeconds).toBe(Math.round(2700 * (HALF_MARATHON_KM / 10) ** 1.06));
  });

  it("anchors on the runner's best effort, not their easy days", () => {
    const easyOnly = predictRace([run(2, 8, 360), run(5, 10, 355)], NOW);
    const withQuality = predictRace([run(2, 8, 360), run(5, 10, 355), run(4, 10, 270)], NOW);
    // The hard 10 km must pull the prediction faster — an average would not.
    expect(withQuality?.paceSecPerKm).toBeLessThan(easyOnly?.paceSecPerKm ?? 0);
    expect(withQuality?.basisKm).toBe(10);
  });

  it("ignores efforts too short to extrapolate from", () => {
    // A blistering 2 km would project an absurd half — it must not anchor.
    expect(predictRace([run(1, 2, 200)], NOW)).toBeNull();
    const prediction = predictRace([run(1, 2, 200), run(6, 10, 300)], NOW);
    expect(prediction?.basisKm).toBe(10);
    expect(prediction?.sampleRuns).toBe(1);
  });

  it("ignores rides and anything outside the lookback window", () => {
    expect(predictRace([run(3, 20, 280, "Ride")], NOW)).toBeNull();
    expect(predictRace([run(200, 10, 260)], NOW)).toBeNull();
    // A run in the future (a clock skew) can't inform today's fitness either.
    expect(predictRace([run(-2, 10, 260)], NOW)).toBeNull();
  });

  it("returns null rather than guessing when there is nothing to go on", () => {
    expect(predictRace([], NOW)).toBeNull();
  });

  it("rates confidence by how much data — and how close a basis — it had", () => {
    expect(predictRace([run(3, 10, 270)], NOW)?.confidence).toBe("low");
    expect(predictRace([run(1, 6, 300), run(3, 6, 300), run(5, 6, 300)], NOW)?.confidence).toBe(
      "medium"
    );
    // Six qualifying runs, and the best of them is a long run near the race
    // distance — a short Riegel hop, so the prediction is worth trusting.
    const many = [
      run(1, 8, 330),
      run(3, 8, 330),
      run(5, 8, 330),
      run(7, 8, 330),
      run(9, 8, 330),
      run(11, 18, 300),
    ];
    const prediction = predictRace(many, NOW);
    expect(prediction?.basisKm).toBe(18);
    expect(prediction?.confidence).toBe("high");
  });

  it("is deterministic — the same input always predicts the same race", () => {
    const activities = [run(2, 12, 300), run(6, 10, 275)];
    expect(predictRace(activities, NOW)).toEqual(predictRace(activities, NOW));
  });
});

describe("zone paces", () => {
  const prediction = predictRace([run(3, 10, 270)], NOW);
  if (!prediction) throw new Error("fixture must predict");

  it("orders the zones by effort — only intervals beat race pace", () => {
    const paces = zonePaces(prediction);
    // Higher seconds/km = slower.
    expect(paces.recovery).toBeGreaterThan(paces.easy);
    expect(paces.easy).toBeGreaterThan(paces.long);
    expect(paces.long).toBeGreaterThan(paces.tempo);
    expect(paces.tempo).toBeGreaterThan(prediction.paceSecPerKm);
    expect(paces.interval).toBeLessThan(prediction.paceSecPerKm);
  });

  it.each(
    Object.keys(PACE_ZONE_SPEED_FRACTION) as PaceZone[]
  )("derives %s pace as a fraction of race speed", (zone) => {
    const expected = prediction.paceSecPerKm / PACE_ZONE_SPEED_FRACTION[zone];
    // Rounded to the 5-second grid a coach actually says out loud.
    expect(zonePaceSeconds(prediction, zone)).toBe(Math.round(expected / 5) * 5);
    expect(zonePaceSeconds(prediction, zone) % 5).toBe(0);
  });
});

describe("formatting", () => {
  it("formats a pace as m:ss and a target as a range", () => {
    expect(formatPaceClock(330)).toBe("5:30");
    expect(formatPaceRange(330)).toBe("5:20–5:40");
  });

  it("formats a race time as h:mm, zero-padding the minutes", () => {
    expect(formatRaceTime(5900)).toBe("1:38");
    expect(formatRaceTime(3660)).toBe("1:01");
  });

  it("rounds a goal time up to the next 5 minutes, so the estimate sits under it", () => {
    expect(goalTimeFor(5900)).toBe("1:40"); // 1:38:20 → 1:40
    expect(goalTimeFor(6000)).toBe("1:40"); // exactly 1:40 stays put
  });
});
