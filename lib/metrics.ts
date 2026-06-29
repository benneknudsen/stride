/**
 * Pure metric helpers for running data.
 *
 * Adapted from the demo fixtures for real DB activity types: speed is stored
 * as meters/second (Strava convention) and may be null, durations are in
 * seconds, and distances are in meters.
 */

/** Convert speed (m/s) to a `min:sec` pace string per km. Null/zero → `--:--`. */
export function formatPace(metersPerSecond: number | null): string {
  if (metersPerSecond === null || metersPerSecond <= 0) {
    return "--:--";
  }

  const secondsPerKm = 1000 / metersPerSecond;
  let mins = Math.floor(secondsPerKm / 60);
  let secs = Math.round(secondsPerKm % 60);
  if (secs === 60) {
    mins += 1;
    secs = 0;
  }

  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Format a duration in seconds as `45 min` (under an hour) or `1:30h`. */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hrs}:${mins.toString().padStart(2, "0")}h`;
}

/** Convert meters to a km string with one decimal place. */
export function formatDistance(meters: number): string {
  return (meters / 1000).toFixed(1);
}

/**
 * Sum distance (meters) for activities falling in a given week offset, where
 * `weeksAgo` of 0 is the current week (Sunday-anchored) and 1 is last week.
 */
export function getWeeklyVolume(
  activities: { startDate: Date; distance: number }[],
  weeksAgo: number
): number {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() - weeksAgo * 7);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  return activities
    .filter((a) => a.startDate >= startOfWeek && a.startDate < endOfWeek)
    .reduce((sum, a) => sum + a.distance, 0);
}

/** Human label for a week offset, used as the x-axis tick on the volume chart. */
export function getWeekLabel(weeksAgo: number): string {
  if (weeksAgo === 0) return "This Week";
  if (weeksAgo === 1) return "Last Week";
  const d = new Date();
  d.setDate(d.getDate() - weeksAgo * 7);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Build the `{ week, km }` series for the weekly-volume chart, oldest week
 * first. Distance is rounded to one decimal kilometre.
 */
export function getWeeklyVolumeSeries(
  activities: { startDate: Date; distance: number }[],
  weeks = 12
): { week: string; km: number }[] {
  return Array.from({ length: weeks }, (_, i) => {
    const weeksAgo = weeks - 1 - i;
    return {
      week: getWeekLabel(weeksAgo),
      km: Math.round(getWeeklyVolume(activities, weeksAgo) / 100) / 10,
    };
  });
}

/** Pace buckets (seconds/km) for the distribution chart. */
export const PACE_BUCKETS = [
  { range: "< 4:30", min: 0, max: 270 },
  { range: "4:30-5:00", min: 270, max: 300 },
  { range: "5:00-5:30", min: 300, max: 330 },
  { range: "5:30-6:00", min: 330, max: 360 },
  { range: "> 6:00", min: 360, max: Number.POSITIVE_INFINITY },
] as const;

/**
 * Count activities into pace buckets. `averageSpeed` is meters/second
 * (nullable); activities without a recorded speed are dropped.
 */
export function getPaceDistribution(
  activities: { averageSpeed: number | null }[]
): { pace: string; count: number }[] {
  const paces = activities
    .map((a) => a.averageSpeed)
    .filter((s): s is number => s !== null && s > 0)
    .map((s) => 1000 / s);

  return PACE_BUCKETS.map((b) => ({
    pace: b.range,
    count: paces.filter((p) => p >= b.min && p < b.max).length,
  }));
}

/** Summary tiles for the dashboard header: weekly volume, 7-day pace, total. */
export function getSummaryStats(
  activities: { startDate: Date; distance: number; movingTime: number }[]
): { thisWeekVolume: number; avgPace: number | null; totalDistance: number } {
  const thisWeekVolume = getWeeklyVolume(activities, 0);

  const recentRuns = activities.slice(0, 7);
  const recentDistance = recentRuns.reduce((sum, a) => sum + a.distance, 0);
  const recentMovingTime = recentRuns.reduce((sum, a) => sum + a.movingTime, 0);
  const avgPace = recentMovingTime > 0 ? recentDistance / recentMovingTime : null;

  const totalDistance = activities.reduce((sum, a) => sum + a.distance, 0);

  return { thisWeekVolume, avgPace, totalDistance };
}
