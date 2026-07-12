import type { GarminActivitySummary } from "./types";

/**
 * Garmin → Stride activity mapping.
 *
 * Two conventions in the `activities` table are Strava's, and Garmin does not
 * share them — the sync normalises to Strava's so that every consumer (the
 * dashboard view-models, the coach engine, the zone charts) keeps reading one
 * shape regardless of which provider the row came in over:
 *
 *  - **Activity type.** Strava's `"Run"` / `"TrailRun"`; Garmin's `"RUNNING"` /
 *    `"TRAIL_RUNNING"`. `isRun()` in `lib/cobalt/hjem.ts` matches `/run/i`, which
 *    a raw `"RUNNING"` would satisfy by accident — but `"TREADMILL_RUNNING"`
 *    would render as its own unlabelled type in the UI's Danish type map.
 *  - **Cadence.** Strava stores single-leg cadence and the UI doubles it to get
 *    steps per minute; Garmin already reports both legs. Halving here keeps the
 *    UI's `× 2` correct instead of showing every Garmin run at ~340 spm.
 */

/** Garmin activity-type enum → Strava's type vocabulary. */
const TYPE_MAP: Record<string, string> = {
  RUNNING: "Run",
  TRAIL_RUNNING: "TrailRun",
  TREADMILL_RUNNING: "VirtualRun",
  INDOOR_RUNNING: "VirtualRun",
  VIRTUAL_RUN: "VirtualRun",
  OBSTACLE_RUN: "Run",
  STREET_RUNNING: "Run",
  TRACK_RUNNING: "Run",
  ULTRA_RUN: "Run",
  CYCLING: "Ride",
  ROAD_BIKING: "Ride",
  MOUNTAIN_BIKING: "Ride",
  INDOOR_CYCLING: "VirtualRide",
  VIRTUAL_RIDE: "VirtualRide",
  LAP_SWIMMING: "Swim",
  OPEN_WATER_SWIMMING: "Swim",
  WALKING: "Walk",
  HIKING: "Hike",
};

/**
 * Map Garmin's SCREAMING_SNAKE enum to Strava's PascalCase. Unknown types fall
 * back to a PascalCase transliteration ("STAND_UP_PADDLEBOARDING" →
 * "StandUpPaddleboarding") rather than being dropped — an unrecognised sport is
 * still a real activity, and the type column is free-text.
 */
export function mapActivityType(garminType: string): string {
  const known = TYPE_MAP[garminType?.toUpperCase()];
  if (known) return known;
  if (!garminType) return "Workout";
  return garminType
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Activity start as a wall-clock instant.
 *
 * Garmin reports UTC epoch seconds plus the athlete's offset; Strava reports
 * `start_date_local` — the local wall clock stamped with a `Z`. Every read in
 * the app (week bucketing, "i dag"-labels) assumes the latter, so we build the
 * same thing: shift the UTC instant by the offset, then stamp it as UTC.
 */
export function startDateFrom(summary: GarminActivitySummary): Date {
  const offset = summary.startTimeOffsetInSeconds ?? 0;
  return new Date((summary.startTimeInSeconds + offset) * 1000);
}

/** Fallback display name — Garmin leaves `activityName` null for auto-detected runs. */
function displayName(summary: GarminActivitySummary): string {
  const name = summary.activityName?.trim();
  if (name) return name;
  const type = mapActivityType(summary.activityType);
  return type === "Run" ? "Løbetur" : type;
}

export function mapGarminActivityToDb(summary: GarminActivitySummary, userId: string) {
  const distance = summary.distanceInMeters ?? 0;
  const elapsedTime = summary.durationInSeconds;
  // Garmin only sends movingDuration when the device recorded pauses; without
  // one, elapsed *is* the moving time.
  const movingTime = summary.movingDurationInSeconds ?? summary.durationInSeconds;

  const averageSpeed =
    summary.averageSpeedInMetersPerSecond ??
    (distance > 0 && movingTime > 0 ? distance / movingTime : null);

  const cadence = summary.averageRunCadenceInStepsPerMinute;

  return {
    userId,
    source: "garmin" as const,
    garminSummaryId: summary.summaryId,
    // Strava's id column is the other provider's key — a Garmin row has none.
    stravaActivityId: null,
    name: displayName(summary),
    type: mapActivityType(summary.activityType),
    startDate: startDateFrom(summary),
    distance,
    movingTime,
    elapsedTime,
    totalElevationGain: summary.totalElevationGainInMeters ?? 0,
    averageSpeed,
    maxSpeed: summary.maxSpeedInMetersPerSecond ?? null,
    averageHeartrate: summary.averageHeartRateInBeatsPerMinute ?? null,
    maxHeartrate: summary.maxHeartRateInBeatsPerMinute ?? null,
    // Both legs → single leg, matching Strava's convention (see module comment).
    averageCadence: cadence != null ? cadence / 2 : null,
    averageWatts: summary.averagePowerInWatts ?? null,
    calories: summary.activeKilocalories ?? null,
    // The Activity *summary* carries no route or per-km splits — those live on
    // the separate activity-details payload — so the zone distribution can't be
    // derived here either. Left null so the UI falls back to its avg-HR estimate
    // rather than storing an all-zero distribution that would read as measured.
    summaryPolyline: null,
    splits: [],
    hrZones: null,
    raw: summary as unknown as Record<string, unknown>,
  };
}
