/**
 * Pure metric helpers for running data.
 *
 * Adapted from the demo fixtures for real DB activity types: speed is stored
 * as meters/second (Strava convention) and may be null, durations are in
 * seconds, and distances are in meters.
 */

import { getLocalDate } from "@/lib/coach/engine";
import { ensureDate } from "@/lib/db/calendar-date";

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

/**
 * Sum distance (meters) for activities falling in a given week offset, where
 * `weeksAgo` of 0 is the current week and 1 is last week.
 *
 * The week is **Monday-anchored** and pinned to the athlete's Danish calendar
 * day, matching the rest of the training domain (`buildPhases` / `getWeekPlan`
 * in lib/coach/engine.ts). It previously anchored on Sunday in the server's
 * timezone, so on Vercel (UTC) a Sunday run landed in the wrong training week
 * and the "this week" tile could disagree with the plan's Monday–Sunday grid.
 * `getLocalDate()` makes the day-of-week read timezone-independent.
 *
 * `now` is injectable so a view-model built against a supplied clock (the plan
 * page passes the request time) buckets its weeks against that same clock —
 * otherwise "this week" here and "this week" there could be different weeks.
 */
export function getWeeklyVolume(
  activities: { startDate: Date; distance: number }[],
  weeksAgo: number,
  now: Date = getLocalDate()
): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(today);
  // getDay() is 0=Sun..6=Sat, so (getDay() + 6) % 7 is the number of days since
  // Monday — the offset back to the start of the training week.
  startOfWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7) - weeksAgo * 7);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  return activities
    .filter((a) => {
      const start = ensureDate(a.startDate);
      return start >= startOfWeek && start < endOfWeek;
    })
    .reduce((sum, a) => sum + a.distance, 0);
}
