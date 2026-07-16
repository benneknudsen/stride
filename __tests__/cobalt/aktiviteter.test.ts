import { describe, expect, it } from "vitest";
import {
  type ActivityCategory,
  activityCategory,
  buildActivitiesView,
  formatTimerLabel,
} from "@/lib/cobalt/aktiviteter";
import type { HomeActivityLike } from "@/lib/cobalt/hjem";

/**
 * Unit tests for the Aktiviteter view-model (lib/cobalt/aktiviteter.ts).
 * Pure derivation — no mocks, all assertions driven by a fixed `now` so the
 * date bucketing is deterministic.
 */

const NOW = new Date(2026, 6, 15, 9, 0); // 15 Jul 2026, local

/** Build a HomeActivityLike run with sensible defaults. */
function run(over: Partial<HomeActivityLike> = {}): HomeActivityLike {
  return {
    id: "a1",
    name: "Morgentur",
    type: "Run",
    startDate: new Date(2026, 6, 14, 7, 30), // 14 Jul 2026
    distance: 10_000,
    movingTime: 2640, // 44 min
    averageSpeed: 3.7,
    averageHeartrate: 140,
    averageCadence: 170,
    totalElevationGain: 20,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// activityCategory
// ---------------------------------------------------------------------------

describe("activityCategory", () => {
  it.each<[number, ActivityCategory]>([
    [1, "rolig"],
    [2, "rolig"],
    [3, "moderat"],
    [4, "haard"],
    [5, "haard"],
  ])("maps intensity level %i to %s", (level, expected) => {
    expect(activityCategory(level)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// formatTimerLabel
// ---------------------------------------------------------------------------

describe("formatTimerLabel", () => {
  it("formats whole and partial hours as h:mm", () => {
    expect(formatTimerLabel(0)).toBe("0:00");
    expect(formatTimerLabel(3600)).toBe("1:00");
    expect(formatTimerLabel(25_860)).toBe("7:11"); // 7h11m
  });

  it("zero-pads the minutes", () => {
    expect(formatTimerLabel(3660)).toBe("1:01");
  });

  it("floors sub-minute remainders", () => {
    expect(formatTimerLabel(59)).toBe("0:00");
  });
});

// ---------------------------------------------------------------------------
// buildActivitiesView
// ---------------------------------------------------------------------------

describe("buildActivitiesView", () => {
  it("keeps only running activities in the totals and rows", () => {
    const view = buildActivitiesView(
      [
        run({ id: "r1", type: "Run" }),
        run({ id: "ride", type: "Ride" }),
        run({ id: "trail", type: "TrailRun" }),
      ],
      NOW
    );
    expect(view.totalRuns).toBe(2);
    expect(view.rows.map((r) => r.id)).toEqual(["r1", "trail"]);
  });

  it("sums km, runs and seconds across the window", () => {
    const view = buildActivitiesView(
      [
        run({ id: "r1", distance: 10_000, movingTime: 2640 }),
        run({ id: "r2", distance: 5_000, movingTime: 1500, startDate: new Date(2026, 6, 10) }),
      ],
      NOW
    );
    expect(view.totalRuns).toBe(2);
    expect(view.totalKm).toBeCloseTo(15, 5);
    expect(view.totalSeconds).toBe(4140);
  });

  it("excludes runs older than the start of the previous calendar month", () => {
    const view = buildActivitiesView(
      [
        run({ id: "recent", startDate: new Date(2026, 6, 1) }), // Jul — in window
        run({ id: "june", startDate: new Date(2026, 5, 2) }), // Jun — in window (prev month)
        run({ id: "may", startDate: new Date(2026, 4, 20) }), // May — out of window
      ],
      NOW
    );
    expect(view.rows.map((r) => r.id)).toEqual(["recent", "june"]);
    expect(view.totalRuns).toBe(2);
  });

  it("derives the zone, category and pace tone from average heart rate", () => {
    // 175 bpm of the 190 default max ≈ 92 % — zone 5 in the shared model (#129).
    const view = buildActivitiesView([run({ averageHeartrate: 175 })], NOW);
    const row = view.rows[0];
    expect(row.zone.level).toBe(5);
    expect(row.category).toBe("haard");
    expect(row.paceTone).toBe("red");
  });

  it("lets a genuinely easy pulse read as zone 1 (issue #129)", () => {
    // 110 bpm of the 190 default max ≈ 58 % — below the zone-2 floor.
    const view = buildActivitiesView([run({ averageHeartrate: 110 })], NOW);
    const row = view.rows[0];
    expect(row.zone.level).toBe(1);
    expect(row.zone.label).toBe("Restitution");
    expect(row.category).toBe("rolig");
  });

  it("resolves the source, defaulting a Garmin row to garmin", () => {
    const view = buildActivitiesView(
      [
        run({ id: "g", source: "garmin" }),
        run({ id: "s", source: "strava", startDate: new Date(2026, 6, 12) }),
      ],
      NOW
    );
    const byId = Object.fromEntries(view.rows.map((r) => [r.id, r.source]));
    expect(byId.g).toBe("garmin");
    expect(byId.s).toBe("strava");
  });

  it("labels a single-month window with just that month", () => {
    const view = buildActivitiesView([run({ startDate: new Date(2026, 6, 3) })], NOW);
    expect(view.periodLabel).toBe("Juli");
  });

  it("labels a two-month span chronologically (prev month – this month)", () => {
    const view = buildActivitiesView(
      [
        run({ id: "jun", startDate: new Date(2026, 5, 20) }),
        run({ id: "jul", startDate: new Date(2026, 6, 3) }),
      ],
      NOW
    );
    expect(view.periodLabel).toBe("Juni – Juli");
  });

  it("orders a year-boundary span December – Januar, not by raw month index", () => {
    const jan = new Date(2026, 0, 15, 9, 0); // 15 Jan 2026
    const view = buildActivitiesView(
      [
        run({ id: "dec", startDate: new Date(2025, 11, 20) }),
        run({ id: "jan", startDate: new Date(2026, 0, 3) }),
      ],
      jan
    );
    expect(view.periodLabel).toBe("December – Januar");
  });

  it("falls back to the current month when the window is empty", () => {
    // All runs older than last month → no rows, header must not read "undefined".
    const view = buildActivitiesView([run({ startDate: new Date(2026, 0, 1) })], NOW);
    expect(view.rows).toHaveLength(0);
    expect(view.totalRuns).toBe(0);
    expect(view.periodLabel).toBe("Juli");
  });

  it("marks today's run with an 'I dag' meta label", () => {
    const view = buildActivitiesView(
      [run({ startDate: new Date(2026, 6, 15, 7, 30), movingTime: 2640 })],
      NOW
    );
    expect(view.rows[0].metaLabel).toBe("I dag 07:30 · 44 min");
  });
});
