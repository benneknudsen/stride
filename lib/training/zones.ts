// Stride — heart-rate zone model. Single source of truth for the 5-zone
// breakdown: colours (brand tokens), labels, the "ideal" training-time split,
// and the pure helpers that turn raw activity data into a zone distribution.
//
// Two data paths feed the breakdown:
//   1. Strava `hr_zones` JSONB (per-activity time-in-zone) — used when present.
//   2. A fallback that buckets an activity's whole moving time into the zone
//      implied by its average HR vs. the athlete's max/resting HR. This keeps
//      the dashboard populated for demo activities and any run Strava synced
//      without zone buckets.

import type { HrZone } from "@/types/domain";

export type ZoneNumber = 1 | 2 | 3 | 4 | 5;

export interface ZoneMeta {
  zone: ZoneNumber;
  /** Short key used as a Recharts dataKey, e.g. "z2". */
  key: `z${ZoneNumber}`;
  /** One-word effort name, e.g. "Aerobic". */
  name: string;
  /** Full descriptor for tooltips/badges, e.g. "Aerobic / Easy". */
  description: string;
  /** Brand-token colour for the zone. */
  color: string;
  /** Ideal share of total training time (%), a polarized aerobic-base split. */
  ideal: number;
}

/**
 * Zone metadata, ordered 1 → 5 (recovery → maximal). Colours map to the Stride
 * brand tokens called out in issue #26: gray, volt, aqua, signal, red.
 */
export const ZONES: Record<ZoneNumber, ZoneMeta> = {
  1: { zone: 1, key: "z1", name: "Recovery", description: "Recovery", color: "#9CA3AF", ideal: 20 },
  2: {
    zone: 2,
    key: "z2",
    name: "Aerobic",
    description: "Aerobic / Easy",
    color: "#C6F432",
    ideal: 50,
  },
  3: { zone: 3, key: "z3", name: "Tempo", description: "Tempo", color: "#33E0CB", ideal: 15 },
  4: {
    zone: 4,
    key: "z4",
    name: "Threshold",
    description: "Threshold",
    color: "#FF5B41",
    ideal: 10,
  },
  5: { zone: 5, key: "z5", name: "VO2 Max", description: "VO2 Max", color: "#EF4444", ideal: 5 },
};

/** Zones 1 → 5 as an array, for mapping over chart series and legends. */
export const ZONE_LIST: ZoneMeta[] = [ZONES[1], ZONES[2], ZONES[3], ZONES[4], ZONES[5]];

/** Fallback max HR when the athlete's is unknown (≈ 220 − 30yo). */
export const DEFAULT_MAX_HR = 190;

export interface ZoneHrConfig {
  /** Athlete max heart rate in bpm. */
  maxHr?: number;
  /** Athlete resting heart rate in bpm — enables Karvonen (%HRR) zoning. */
  restingHr?: number;
}

/**
 * Map a heart rate (bpm) to its zone (1–5). Uses %HRR (Karvonen) when a resting
 * HR is supplied, otherwise plain %max HR. Boundaries follow the common 5-zone
 * model: 60 / 70 / 80 / 90 % mark the Z2–Z5 floors.
 */
export function zoneForHeartRate(bpm: number, config: ZoneHrConfig = {}): ZoneNumber {
  const { maxHr = DEFAULT_MAX_HR, restingHr } = config;

  const intensity =
    restingHr != null && restingHr < maxHr ? (bpm - restingHr) / (maxHr - restingHr) : bpm / maxHr;

  if (intensity >= 0.9) return 5;
  if (intensity >= 0.8) return 4;
  if (intensity >= 0.7) return 3;
  if (intensity >= 0.6) return 2;
  return 1;
}

/** Minimal activity shape the aggregator reads. */
export interface ZoneActivityInput {
  hrZones?: HrZone[] | null;
  averageHeartrate?: number | null;
  movingTime?: number | null;
}

/** One zone's slice of the aggregated breakdown. */
export interface ZoneSlice {
  meta: ZoneMeta;
  seconds: number;
  /** Share of total time, 0–100. */
  percent: number;
}

export interface ZoneBreakdown {
  /** Always five slices, ordered zone 1 → 5. */
  slices: ZoneSlice[];
  totalSeconds: number;
}

/**
 * Aggregate time-in-zone across many activities into a single breakdown.
 * Prefers each activity's `hrZones`; falls back to bucketing the whole moving
 * time into the zone implied by average HR when zone buckets are absent.
 */
export function aggregateZones(
  activities: ZoneActivityInput[],
  config: ZoneHrConfig = {}
): ZoneBreakdown {
  const seconds: Record<ZoneNumber, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  for (const activity of activities) {
    if (activity.hrZones && activity.hrZones.length > 0) {
      for (const bucket of activity.hrZones) {
        if (bucket.zone >= 1 && bucket.zone <= 5) {
          seconds[bucket.zone as ZoneNumber] += bucket.seconds;
        }
      }
    } else if (
      activity.averageHeartrate != null &&
      activity.averageHeartrate > 0 &&
      activity.movingTime
    ) {
      const zone = zoneForHeartRate(activity.averageHeartrate, config);
      seconds[zone] += activity.movingTime;
    }
  }

  const totalSeconds = ZONE_LIST.reduce((sum, meta) => sum + seconds[meta.zone], 0);

  const slices: ZoneSlice[] = ZONE_LIST.map((meta) => ({
    meta,
    seconds: seconds[meta.zone],
    percent: totalSeconds > 0 ? (seconds[meta.zone] / totalSeconds) * 100 : 0,
  }));

  return { slices, totalSeconds };
}

/** Format a span of seconds compactly, e.g. `45m` or `12h 30m`. */
export function formatZoneTime(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}
