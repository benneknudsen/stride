import type { DashboardActivity } from "@/lib/db/queries";
import { aggregateZones } from "@/lib/training/zones";
import type { HrZone } from "@/types/domain";
import { ZoneBreakdownChartClient } from "./zone-breakdown-chart.client";

export function ZoneBreakdownChart({ activities }: { activities: DashboardActivity[] }) {
  const breakdown = aggregateZones(
    activities.map((a) => ({
      hrZones: a.hrZones as HrZone[] | null,
      averageHeartrate: a.averageHeartrate,
      movingTime: a.movingTime,
    }))
  );

  return <ZoneBreakdownChartClient breakdown={breakdown} />;
}
