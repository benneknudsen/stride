import {
  ZONE_LIST,
  type ZoneHrConfig,
  type ZoneNumber,
  zoneBounds,
  zoneForHeartRate,
} from "@/lib/training/zones";
import type { HrZone } from "@/types/domain";
import type { DetailedActivity, Split, SummaryActivity } from "./types";

export type Activity = {
  stravaActivityId: number;
  name: string;
  type: string;
  startDate: Date;
  distanceM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  elevationGainM: number;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  avgWatts: number | null;
  calories: number | null;
  sufferScore: number | null;
  polyline: string | null;
  splits: Split[];
};

/**
 * Derive time-in-zone buckets from per-kilometer splits (issue #101).
 *
 * Strava's activity payload carries no zone distribution — that lives behind a
 * separate, heavily rate-limited `/activities/{id}/zones` endpoint — but each
 * split in `splits_metric` reports its own average HR. Bucketing every split's
 * moving time into the zone its average HR falls in gives a genuine per-segment
 * distribution instead of the whole-run average-HR guess the UI falls back to.
 *
 * Returns `null` when no split carries usable HR (athlete opted out, no strap,
 * or a summary-only payload) so callers can leave `hr_zones` untouched rather
 * than writing an all-zero distribution that would read as measured data.
 */
export function hrZonesFromSplits(splits: Split[], config: ZoneHrConfig = {}): HrZone[] | null {
  const seconds: Record<ZoneNumber, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let usable = 0;

  for (const split of splits) {
    const hr = split.average_heartrate;
    const time = split.moving_time || split.elapsed_time;
    if (hr == null || hr <= 0 || !time || time <= 0) continue;
    seconds[zoneForHeartRate(hr, config)] += time;
    usable++;
  }

  if (usable === 0) return null;

  const bounds = zoneBounds(config);
  return ZONE_LIST.map((meta) => ({
    zone: meta.zone,
    min: bounds[meta.zone].min,
    max: bounds[meta.zone].max,
    seconds: seconds[meta.zone],
  }));
}

export function mapStravaActivity(raw: DetailedActivity): Activity {
  return {
    stravaActivityId: raw.id,
    name: raw.name,
    type: raw.type,
    startDate: new Date(raw.start_date_local),
    distanceM: raw.distance,
    movingTimeS: raw.moving_time,
    elapsedTimeS: raw.elapsed_time,
    elevationGainM: raw.total_elevation_gain,
    avgSpeedMps: raw.average_speed ?? null,
    // Strava reports both speeds in m/s — the same unit the DB column stores.
    maxSpeedMps: raw.max_speed ?? null,
    avgHr: raw.average_heartrate ?? null,
    maxHr: raw.max_heartrate ?? null,
    avgCadence: raw.average_cadence ?? null,
    // Only trust power from a real meter; for runs without one Strava reports an
    // estimate that would be stored as if it were measured.
    avgWatts: raw.device_watts ? (raw.average_watts ?? null) : null,
    calories: raw.calories ?? null,
    sufferScore: (raw as unknown as { suffer_score?: number }).suffer_score ?? null,
    polyline: raw.map?.summary_polyline ?? null,
    splits: raw.splits_metric ?? [],
  };
}

export function mapStravaToDb(raw: DetailedActivity, userId: string, config: ZoneHrConfig = {}) {
  const mapped = mapStravaActivity(raw);
  // An athlete who opted out of sharing HR has no per-split HR either; skip the
  // derivation entirely so we never invent zones for them.
  const hrZones = raw.heartrate_opt_out ? null : hrZonesFromSplits(mapped.splits, config);

  return {
    userId,
    stravaActivityId: mapped.stravaActivityId,
    name: mapped.name,
    type: mapped.type,
    startDate: mapped.startDate,
    distance: mapped.distanceM,
    movingTime: mapped.movingTimeS,
    elapsedTime: mapped.elapsedTimeS,
    totalElevationGain: mapped.elevationGainM,
    averageSpeed: mapped.avgSpeedMps,
    maxSpeed: mapped.maxSpeedMps,
    averageHeartrate: mapped.avgHr,
    maxHeartrate: mapped.maxHr,
    averageCadence: mapped.avgCadence,
    averageWatts: mapped.avgWatts,
    calories: mapped.calories,
    summaryPolyline: mapped.polyline,
    splits: mapped.splits,
    hrZones,
    raw: raw as unknown as Record<string, unknown>,
  };
}

/**
 * Map a `SummaryActivity` straight to a DB row — no per-activity detail fetch
 * (issue #76 B7). The list endpoint already returns every column the dashboard
 * reads (distance, times, HR, cadence, polyline), so the historical sync uses
 * this to avoid the N+1 detail call. `splits` are only on the detailed payload
 * and have no dashboard consumer, so they're empty here; `raw` keeps the summary
 * payload for parity. New activities still go through {@link mapStravaToDb} via
 * the webhook, which does fetch full detail.
 *
 * `calories` and `hr_zones` are deliberately absent: neither is derivable from a
 * summary (calories is detail-only, zones come from `splits_metric`). The sync
 * route therefore leaves both columns out of its upsert `set` list so a backfill
 * can't blank out what the webhook already measured — see issue #101.
 */
export function mapStravaSummaryToDb(summary: SummaryActivity, userId: string) {
  return {
    userId,
    stravaActivityId: summary.id,
    name: summary.name,
    type: summary.type,
    startDate: new Date(summary.start_date_local),
    distance: summary.distance,
    movingTime: summary.moving_time,
    elapsedTime: summary.elapsed_time,
    totalElevationGain: summary.total_elevation_gain,
    averageSpeed: summary.average_speed ?? null,
    maxSpeed: summary.max_speed ?? null,
    averageHeartrate: summary.average_heartrate ?? null,
    maxHeartrate: summary.max_heartrate ?? null,
    averageCadence: summary.average_cadence ?? null,
    averageWatts: summary.device_watts ? (summary.average_watts ?? null) : null,
    summaryPolyline: summary.map?.summary_polyline ?? null,
    splits: [] as Split[],
    raw: summary as unknown as Record<string, unknown>,
  };
}
