import type { DashboardActivity } from "@/lib/db/queries";
import { getWeeklyVolumeSeries } from "@/lib/metrics";
import { WeeklyVolumeChartClient } from "./weekly-volume-chart.client";

export function WeeklyVolumeChart({
  activities,
  from,
}: {
  activities: DashboardActivity[];
  from: Date;
}) {
  // Bound the shared dashboard slice to the last 12 weeks so the volume buckets
  // match the original per-component query's `from` window.
  const scoped = activities.filter((a) => a.startDate >= from);

  return <WeeklyVolumeChartClient data={getWeeklyVolumeSeries(scoped, 12)} />;
}
