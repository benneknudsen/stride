// Stride — coach dashboard data access (issue #34). The server-side seam
// between the pure view-model builders and the /dashboard/coach sections.
//
// Two freshness tiers, per the issue:
//   - The workout card is real-time: recomputed on every request.
//   - The progression charts are cached for 1 hour (`revalidate: 3600`) and
//     tagged "progression" so a new activity sync can revalidate them early.
//
// Data source (issue #86): the signed-in user's own runs, passed in by the page
// (getDashboardActivities); the seeded demo fixtures are the fallback for
// visitors and for users with nothing synced yet (see CLAUDE.md).

import { revalidateTag, unstable_cache } from "next/cache";
import {
  buildCoachDashboard,
  type CoachActivityInput,
  type CoachDashboardData,
  DASHBOARD_WEEKS,
} from "@/lib/coach/dashboard";
import { DEFAULT_RACE_DATE } from "@/lib/coach/engine";
import { demoActivities } from "@/lib/demo/data";

/** Cache tag on the progression charts — busted when new activity data lands. */
const PROGRESSION_TAG = "progression";

/** Cache scope for the fixture path — see {@link getProgressionCharts}. */
const DEMO_SCOPE = "demo";

/**
 * The full dashboard, computed fresh — the real-time workout card path.
 * `activities` defaults to the demo fixtures; `raceDate` anchors the phases
 * (issue #99), omitted → the demo default.
 */
export function computeCoachDashboard(
  activities: CoachActivityInput[] = demoActivities,
  raceDate?: Date
): CoachDashboardData {
  return buildCoachDashboard(activities, new Date(), DASHBOARD_WEEKS, raceDate);
}

/**
 * The progression section's chart data, cached for an hour.
 *
 * Both inputs that can change the output are part of the cache key: `scope`
 * (the user's id, or "demo") so one user's charts can never be served to
 * another, and the race date, because the phase — and thus the workout the
 * charts sit beside — depends on it. Changing the race via `updateRacePlan`
 * both misses this key and hard-expires the tag (see `actions/race.ts`); a new
 * activity sync expires it via {@link revalidateProgression}.
 */
export function getProgressionCharts({
  activities = demoActivities,
  raceDate,
  scope = DEMO_SCOPE,
}: {
  activities?: CoachActivityInput[];
  raceDate?: Date;
  scope?: string;
} = {}) {
  const keyDate = (raceDate ?? DEFAULT_RACE_DATE).toISOString();
  return unstable_cache(
    async () => {
      const { paceSeries, zoneSeries, volumeSeries, loadGauge } = computeCoachDashboard(
        activities,
        raceDate
      );
      return { paceSeries, zoneSeries, volumeSeries, loadGauge };
    },
    ["coach-dashboard-progression", scope, keyDate],
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
