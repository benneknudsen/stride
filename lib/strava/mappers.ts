import type { DetailedActivity, Split } from "./types";

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
