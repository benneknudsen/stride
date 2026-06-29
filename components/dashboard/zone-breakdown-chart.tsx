import { auth } from "@/lib/auth";
import { getActivities } from "@/lib/db/queries";
import { aggregateZones } from "@/lib/training/zones";
import type { HrZone } from "@/types/domain";
import { ZoneBreakdownChartClient } from "./zone-breakdown-chart.client";

export async function ZoneBreakdownChart() {
  const session = await auth();
  const userId = session?.user?.id;
  const activities = userId ? await getActivities(userId, { limit: 500 }) : [];

  const breakdown = aggregateZones(
    activities.map((a) => ({
      hrZones: a.hrZones as HrZone[] | null,
      averageHeartrate: a.averageHeartrate,
      movingTime: a.movingTime,
    }))
  );

  return <ZoneBreakdownChartClient breakdown={breakdown} />;
}
