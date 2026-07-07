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

import { unstable_cache } from "next/cache";
import { buildCoachDashboard, type CoachDashboardData } from "@/lib/coach/dashboard";
import { demoActivities } from "@/lib/demo/data";

/** The full dashboard, computed fresh — the real-time workout card path. */
export function computeCoachDashboard(): CoachDashboardData {
  return buildCoachDashboard(demoActivities, new Date());
}

/** The middle section's chart data, cached for an hour. */
export const getProgressionCharts = unstable_cache(
  async () => {
    const { paceSeries, zoneSeries, volumeSeries, loadGauge } = computeCoachDashboard();
    return { paceSeries, zoneSeries, volumeSeries, loadGauge };
  },
  ["coach-dashboard-progression"],
  { revalidate: 3600, tags: ["progression"] }
);
