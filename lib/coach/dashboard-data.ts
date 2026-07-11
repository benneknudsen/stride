// Stride — coach dashboard data access (issue #34). The server-side seam
// between the pure view-model builders and the /dashboard/coach sections.
//
// Two freshness tiers, per the issue:
//   - The workout card is real-time: recomputed on every request.
//   - The progression charts are cached for 1 hour (`revalidate: 3600`) and
//     tagged "progression" so a new activity sync can revalidate them early.
//
// Data source: the seeded demo fixtures, like every other Cobalt Glass page —
// portfolio visitors won't connect Strava (see CLAUDE.md).

import { revalidateTag, unstable_cache } from "next/cache";
import { buildCoachDashboard, type CoachDashboardData, DASHBOARD_WEEKS } from "@/lib/coach/dashboard";
import { DEFAULT_RACE_DATE } from "@/lib/coach/engine";
import { demoActivities } from "@/lib/demo/data";

/** Cache tag on the progression charts — busted when new activity data lands. */
const PROGRESSION_TAG = "progression";

/**
 * The full dashboard, computed fresh — the real-time workout card path.
 * `raceDate` anchors the phases (issue #99); omitted → the demo default.
 */
export function computeCoachDashboard(raceDate?: Date): CoachDashboardData {
  return buildCoachDashboard(demoActivities, new Date(), DASHBOARD_WEEKS, raceDate);
}

/**
 * The middle section's chart data, cached for an hour. The phase (and thus the
 * workout the charts sit beside) depends on the race date, so it is part of
 * the cache key — changing the race via `updateRacePlan` both misses this key
 * and hard-expires the tag (see `actions/race.ts`).
 */
export function getProgressionCharts(raceDate?: Date) {
  const keyDate = (raceDate ?? DEFAULT_RACE_DATE).toISOString();
  return unstable_cache(
    async () => {
      const { paceSeries, zoneSeries, volumeSeries, loadGauge } = computeCoachDashboard(raceDate);
      return { paceSeries, zoneSeries, volumeSeries, loadGauge };
    },
    ["coach-dashboard-progression", keyDate],
    { revalidate: 3600, tags: [PROGRESSION_TAG] }
  )();
}

/**
 * Expire the progression-chart cache immediately. Called by the Strava webhook
 * and sync routes when activity data changes, so the 1 h cache never serves
 * charts that predate the newest run (`expire: 0` = hard expiry, matching the
 * pre-Next-16 `revalidateTag` behaviour).
 */
export function revalidateProgression(): void {
  revalidateTag(PROGRESSION_TAG, { expire: 0 });
}
