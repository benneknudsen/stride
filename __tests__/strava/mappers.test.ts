import { describe, expect, it } from "vitest";
import { hrZonesFromSplits, mapStravaSummaryToDb, mapStravaToDb } from "@/lib/strava/mappers";
import type { DetailedActivity, Split, SummaryActivity } from "@/lib/strava/types";

/**
 * Issue #101 — the sync used to drop `hr_zones`, `calories` and `max_speed` on
 * the floor, so every real user's activity detail and coach zone chart rendered
 * the "Estimeret" fallback. These tests pin the columns the mappers must fill.
 */

function split(overrides: Partial<Split> = {}): Split {
  return {
    distance: 1000,
    elapsed_time: 300,
    elevation_difference: 0,
    moving_time: 300,
    split: 1,
    average_speed: 3.33,
    average_grade_adjusted_speed: null,
    average_heartrate: 150,
    pace_zone: 2,
    ...overrides,
  };
}

function summary(overrides: Partial<SummaryActivity> = {}): SummaryActivity {
  return {
    id: 42,
    name: "Morgentur",
    distance: 10_000,
    moving_time: 3000,
    elapsed_time: 3100,
    total_elevation_gain: 55,
    type: "Run",
    sport_type: "Run",
    start_date: "2026-07-01T06:00:00Z",
    start_date_local: "2026-07-01T08:00:00Z",
    timezone: "Europe/Copenhagen",
    average_speed: 3.33,
    max_speed: 4.5,
    average_heartrate: 150,
    max_heartrate: 178,
    average_cadence: 88,
    map: { id: "a42", summary_polyline: "abc", resource_state: 2 },
    trainer: false,
    commute: false,
    manual: false,
    private: false,
    visibility: "everyone",
    flagged: false,
    gear_id: null,
    kilojoules: null,
    average_watts: null,
    device_watts: null,
    max_watts: null,
    weighted_average_watts: null,
    elev_high: 40,
    elev_low: 5,
    ...overrides,
  };
}

function detailed(overrides: Partial<DetailedActivity> = {}): DetailedActivity {
  return {
    ...summary(),
    description: null,
    calories: 720,
    splits_metric: [split({ split: 1 }), split({ split: 2 })],
    splits_standard: [],
    laps: [],
    segment_efforts: [],
    photos: null,
    device_name: "Garmin Forerunner",
    embed_token: null,
    ...overrides,
  };
}

describe("hrZonesFromSplits", () => {
  it("buckets each split's moving time into the zone of its average HR", () => {
    // maxHr defaults to 190 → 150 bpm ≈ 79 % → Z3, 175 bpm ≈ 92 % → Z5.
    const zones = hrZonesFromSplits([
      split({ average_heartrate: 150, moving_time: 300 }),
      split({ average_heartrate: 150, moving_time: 240 }),
      split({ average_heartrate: 175, moving_time: 120 }),
    ]);

    expect(zones).not.toBeNull();
    const byZone = Object.fromEntries((zones ?? []).map((z) => [z.zone, z.seconds]));
    expect(byZone[3]).toBe(540);
    expect(byZone[5]).toBe(120);
    expect(byZone[1]).toBe(0);
  });

  it("always returns all five zones, with bounds and an open-ended top zone", () => {
    const zones = hrZonesFromSplits([split()]) ?? [];

    expect(zones.map((z) => z.zone)).toEqual([1, 2, 3, 4, 5]);
    expect(zones[1]).toMatchObject({ min: 114, max: 132 }); // 60–70 % of 190
    expect(zones[4]).toMatchObject({ min: 171, max: null });
  });

  it("honours a custom max/resting HR (Karvonen)", () => {
    // 150 bpm at maxHr 200 / restingHr 50 → 66 % HRR → Z2, not Z3.
    const zones =
      hrZonesFromSplits([split({ average_heartrate: 150, moving_time: 600 })], {
        maxHr: 200,
        restingHr: 50,
      }) ?? [];

    expect(zones.find((z) => z.zone === 2)?.seconds).toBe(600);
    expect(zones.find((z) => z.zone === 3)?.seconds).toBe(0);
  });

  it("returns null when no split carries heart rate", () => {
    expect(hrZonesFromSplits([split({ average_heartrate: null })])).toBeNull();
    expect(hrZonesFromSplits([])).toBeNull();
  });

  it("ignores splits without HR but keeps the ones that have it", () => {
    const zones =
      hrZonesFromSplits([
        split({ average_heartrate: null, moving_time: 999 }),
        split({ average_heartrate: 150, moving_time: 300 }),
      ]) ?? [];

    const total = zones.reduce((sum, z) => sum + z.seconds, 0);
    expect(total).toBe(300);
  });
});

describe("mapStravaToDb", () => {
  it("writes hrZones, calories and maxSpeed", () => {
    const row = mapStravaToDb(detailed(), "user-1");

    expect(row.calories).toBe(720);
    expect(row.maxSpeed).toBe(4.5); // m/s, same unit as averageSpeed and the column
    expect(row.hrZones).not.toBeNull();
    expect(row.hrZones?.reduce((sum, z) => sum + z.seconds, 0)).toBe(600);
  });

  it("leaves hrZones null when the athlete opted out of sharing HR", () => {
    const row = mapStravaToDb(detailed({ heartrate_opt_out: true }), "user-1");
    expect(row.hrZones).toBeNull();
  });

  it("leaves hrZones null when the activity has no splits", () => {
    const row = mapStravaToDb(detailed({ splits_metric: [] }), "user-1");
    expect(row.hrZones).toBeNull();
  });

  it("only stores power measured by a real meter", () => {
    expect(mapStravaToDb(detailed({ average_watts: 240 }), "user-1").averageWatts).toBeNull();
    expect(
      mapStravaToDb(detailed({ average_watts: 240, device_watts: true }), "user-1").averageWatts
    ).toBe(240);
  });

  it("keeps the fields the dashboard already relied on", () => {
    const row = mapStravaToDb(detailed(), "user-1");

    expect(row).toMatchObject({
      userId: "user-1",
      stravaActivityId: 42,
      name: "Morgentur",
      type: "Run",
      distance: 10_000,
      movingTime: 3000,
      elapsedTime: 3100,
      totalElevationGain: 55,
      averageSpeed: 3.33,
      averageHeartrate: 150,
      maxHeartrate: 178,
      averageCadence: 88,
      summaryPolyline: "abc",
    });
    expect(row.splits).toHaveLength(2);
  });
});

describe("mapStravaSummaryToDb", () => {
  it("writes maxSpeed from the list payload", () => {
    expect(mapStravaSummaryToDb(summary(), "user-1").maxSpeed).toBe(4.5);
    expect(mapStravaSummaryToDb(summary({ max_speed: null }), "user-1").maxSpeed).toBeNull();
  });

  it("carries no calories or hrZones — a summary can't measure either", () => {
    const row = mapStravaSummaryToDb(summary(), "user-1");

    // The sync route's upsert `set` list mirrors these keys, so absence here is
    // what stops a backfill from blanking the webhook's measured values.
    expect(row).not.toHaveProperty("calories");
    expect(row).not.toHaveProperty("hrZones");
  });
});
