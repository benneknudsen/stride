import type { DashboardActivity } from "@/lib/db/queries";
import { getPaceDistribution } from "@/lib/metrics";
import { PaceDistributionChartClient } from "./pace-distribution-chart.client";

export function PaceDistributionChart({ activities }: { activities: DashboardActivity[] }) {
  return <PaceDistributionChartClient data={getPaceDistribution(activities)} />;
}
