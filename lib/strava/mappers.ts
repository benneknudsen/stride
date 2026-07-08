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
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  sufferScore: number | null;
  polyline: string | null;
  splits: Split[];
};

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
    avgHr: raw.average_heartrate ?? null,
    maxHr: raw.max_heartrate ?? null,
    avgCadence: raw.average_cadence ?? null,
    sufferScore: (raw as unknown as { suffer_score?: number }).suffer_score ?? null,
    polyline: raw.map?.summary_polyline ?? null,
    splits: raw.splits_metric ?? [],
  };
}

export function mapStravaToDb(raw: DetailedActivity, userId: string) {
  const mapped = mapStravaActivity(raw);
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
    averageHeartrate: mapped.avgHr,
    maxHeartrate: mapped.maxHr,
    averageCadence: mapped.avgCadence,
    summaryPolyline: mapped.polyline,
    splits: mapped.splits,
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
    averageHeartrate: summary.average_heartrate ?? null,
    maxHeartrate: summary.max_heartrate ?? null,
    averageCadence: summary.average_cadence ?? null,
    summaryPolyline: summary.map?.summary_polyline ?? null,
    splits: [] as Split[],
    raw: summary as unknown as Record<string, unknown>,
  };
}
