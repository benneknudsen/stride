import { describe, expect, it } from "vitest";
import { sourceOf } from "@/lib/cobalt/hjem";
import { mapActivityType, mapGarminActivityToDb, startDateFrom } from "@/lib/garmin/mappers";
import type { GarminActivitySummary } from "@/lib/garmin/types";

/**
 * Issue #35 — Garmin rows have to land in the same `activities` shape Strava's
 * do, or every downstream consumer (dashboard, coach engine, badges) reads a
 * second dialect. These pin the three places Garmin's payload disagrees with
 * Strava's: the type vocabulary, the cadence convention, and the clock.
 */

function summary(overrides: Partial<GarminActivitySummary> = {}): GarminActivitySummary {
  return {
    summaryId: "x153.1652667514",
    activityId: 9_876_543,
    activityName: "Morgentur",
    activityType: "RUNNING",
    startTimeInSeconds: 1_700_000_000,
    startTimeOffsetInSeconds: 7200,
    durationInSeconds: 3600,
    movingDurationInSeconds: 3500,
    distanceInMeters: 10_000,
    averageSpeedInMetersPerSecond: 2.86,
    maxSpeedInMetersPerSecond: 4.2,
    averageHeartRateInBeatsPerMinute: 152,
    maxHeartRateInBeatsPerMinute: 178,
    averageRunCadenceInStepsPerMinute: 172,
    averagePowerInWatts: 260,
    totalElevationGainInMeters: 84,
    activeKilocalories: 620,
    ...overrides,
  };
}

describe("mapActivityType", () => {
  it("translates Garmin's enum into Strava's type vocabulary", () => {
    expect(mapActivityType("RUNNING")).toBe("Run");
    expect(mapActivityType("TRAIL_RUNNING")).toBe("TrailRun");
    expect(mapActivityType("TREADMILL_RUNNING")).toBe("VirtualRun");
    expect(mapActivityType("CYCLING")).toBe("Ride");
  });

  it("PascalCases an unknown sport instead of dropping it", () => {
    expect(mapActivityType("STAND_UP_PADDLEBOARDING")).toBe("StandUpPaddleboarding");
  });

  it("falls back to a generic type for an empty value", () => {
    expect(mapActivityType("")).toBe("Workout");
  });
});

describe("startDateFrom", () => {
  it("shifts the UTC instant by the athlete's offset, matching Strava's start_date_local", () => {
    // 1_700_000_000 = 2023-11-14T22:13:20Z; +2h local → 2023-11-15T00:13:20.
    const date = startDateFrom(summary({ startTimeOffsetInSeconds: 7200 }));
    expect(date.toISOString()).toBe("2023-11-15T00:13:20.000Z");
  });

  it("treats a missing offset as UTC", () => {
    const date = startDateFrom(summary({ startTimeOffsetInSeconds: undefined }));
    expect(date.toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });
});

describe("mapGarminActivityToDb", () => {
  it("keys the row on summaryId and marks the source, leaving Strava's id null", () => {
    const row = mapGarminActivityToDb(summary(), "user-1");
    expect(row.garminSummaryId).toBe("x153.1652667514");
    expect(row.source).toBe("garmin");
    expect(row.stravaActivityId).toBeNull();
    expect(row.userId).toBe("user-1");
  });

  it("halves Garmin's two-leg cadence into Strava's single-leg convention", () => {
    // The UI doubles this back to steps/min; without the halving every Garmin
    // run would render at ~344 spm.
    const row = mapGarminActivityToDb(summary({ averageRunCadenceInStepsPerMinute: 172 }), "u");
    expect(row.averageCadence).toBe(86);
  });

  it("leaves cadence null when the device reported none", () => {
    const row = mapGarminActivityToDb(summary({ averageRunCadenceInStepsPerMinute: null }), "u");
    expect(row.averageCadence).toBeNull();
  });

  it("carries the metrics Strava's summary sync used to drop (#101)", () => {
    const row = mapGarminActivityToDb(summary(), "u");
    expect(row.calories).toBe(620);
    expect(row.maxSpeed).toBe(4.2);
    expect(row.maxHeartrate).toBe(178);
    expect(row.averageWatts).toBe(260);
  });

  it("uses elapsed as moving time when the device recorded no pauses", () => {
    const row = mapGarminActivityToDb(
      summary({ movingDurationInSeconds: null, durationInSeconds: 3600 }),
      "u"
    );
    expect(row.movingTime).toBe(3600);
    expect(row.elapsedTime).toBe(3600);
  });

  it("derives average speed when Garmin omits it", () => {
    const row = mapGarminActivityToDb(
      summary({
        averageSpeedInMetersPerSecond: null,
        distanceInMeters: 10_000,
        movingDurationInSeconds: 2500,
      }),
      "u"
    );
    expect(row.averageSpeed).toBe(4);
  });

  it("does not divide by zero on a distance-less activity", () => {
    const row = mapGarminActivityToDb(
      summary({ averageSpeedInMetersPerSecond: null, distanceInMeters: null }),
      "u"
    );
    expect(row.distance).toBe(0);
    expect(row.averageSpeed).toBeNull();
  });

  it("names an auto-detected run rather than storing an empty title", () => {
    const row = mapGarminActivityToDb(summary({ activityName: null }), "u");
    expect(row.name).toBe("Løbetur");
  });

  it("leaves splits, zones and route empty — the summary payload cannot carry them", () => {
    const row = mapGarminActivityToDb(summary(), "u");
    expect(row.hrZones).toBeNull();
    expect(row.summaryPolyline).toBeNull();
    expect(row.splits).toEqual([]);
  });
});

describe("sourceOf", () => {
  it("badges a row by its own source column", () => {
    expect(sourceOf({ source: "garmin" })).toBe("garmin");
    expect(sourceOf({ source: "strava" })).toBe("strava");
  });

  it("falls back to strava for demo fixtures and pre-#35 rows", () => {
    expect(sourceOf({})).toBe("strava");
    expect(sourceOf({ source: null })).toBe("strava");
    // An unknown provider must not be trusted straight into the badge's lookup.
    expect(sourceOf({ source: "polar" })).toBe("strava");
  });
});
