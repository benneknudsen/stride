import { describe, expect, it } from "vitest";
import {
  estimateRaceTime,
  formatRaceTime,
  goalTimeFromEstimate,
  inferRaceDistanceKm,
  racePaceFromEstimate,
} from "@/lib/cobalt/race-estimate";

const NOW = new Date(2026, 6, 15, 9, 0);

function run(daysAgo: number, km: number, paceSecondsPerKm: number) {
  return {
    distance: km * 1000,
    movingTime: km * paceSecondsPerKm,
    startDate: new Date(NOW.getTime() - daysAgo * 86_400_000),
  };
}

describe("inferRaceDistanceKm", () => {
  it.each([
    ["Silkeborg Halvmarathon", 21.0975],
    ["CPH Half", 21.0975],
    ["Copenhagen Half Marathon", 21.0975],
    ["Berlin Marathon", 42.195],
    ["Eremitageløbet 13,3 km", 13.3],
    ["Royal Run 10 km", 10],
    ["Parkrun 5k", 5],
  ])("reads %s as %f km", (name, expected) => {
    expect(inferRaceDistanceKm(name)).toBeCloseTo(expected, 4);
  });

  it("returns null for names that imply no distance", () => {
    expect(inferRaceDistanceKm("Din race")).toBeNull();
    expect(inferRaceDistanceKm(null)).toBeNull();
    expect(inferRaceDistanceKm(undefined)).toBeNull();
    expect(inferRaceDistanceKm("Sommerstafetten")).toBeNull();
  });
});

describe("estimateRaceTime", () => {
  it("predicts with Riegel from the longest recent run", () => {
    // 15 km at 5:30/km → half marathon ≈ 15×330 × (21.0975/15)^1.06.
    const estimate = estimateRaceTime([run(3, 15, 330), run(5, 8, 300)], 21.0975, NOW);
    expect(estimate).not.toBeNull();
    const expected = 15 * 330 * (21.0975 / 15) ** 1.06;
    expect(estimate?.seconds).toBe(Math.round(expected));
    expect(estimate?.distanceKm).toBeCloseTo(21.0975, 4);
  });

  it("ignores runs older than the reference window and too-short runs", () => {
    expect(estimateRaceTime([run(60, 20, 330)], 21.0975, NOW)).toBeNull();
    expect(estimateRaceTime([run(3, 2, 330)], 21.0975, NOW)).toBeNull();
  });

  it("returns null with no runs at all", () => {
    expect(estimateRaceTime([], 21.0975, NOW)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats times above an hour as h:mm and below as m:ss", () => {
    expect(formatRaceTime(2 * 3600 + 5 * 60)).toBe("2:05");
    expect(formatRaceTime(58 * 60 + 12)).toBe("58:12");
  });

  it("rounds the goal time UP to the next 5 minutes", () => {
    expect(goalTimeFromEstimate(1 * 3600 + 56 * 60)).toBe("2:00");
    expect(goalTimeFromEstimate(1 * 3600 + 55 * 60)).toBe("1:55");
  });

  it("derives the implied per-km race pace", () => {
    expect(racePaceFromEstimate({ distanceKm: 10, seconds: 3300 })).toBe("5:30");
  });
});
