import { auth } from "@/lib/auth";
import { getActivities } from "@/lib/db/queries";
import { getWeeklyVolumeSeries } from "@/lib/metrics";
import { WeeklyVolumeChartClient } from "./weekly-volume-chart.client";

export async function WeeklyVolumeChart() {
  const session = await auth();
  const userId = session?.user?.id;

  // Fetch the last 12 weeks of activities so the volume buckets are complete
  // (the default getActivities limit would truncate active users' history).
  const since = new Date();
  since.setDate(since.getDate() - 12 * 7);
  const activities = userId ? await getActivities(userId, { from: since, limit: 500 }) : [];

  return <WeeklyVolumeChartClient data={getWeeklyVolumeSeries(activities, 12)} />;
}
