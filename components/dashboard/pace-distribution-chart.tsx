import { auth } from "@/lib/auth";
import { getActivities } from "@/lib/db/queries";
import { getPaceDistribution } from "@/lib/metrics";
import { PaceDistributionChartClient } from "./pace-distribution-chart.client";

export async function PaceDistributionChart() {
  const session = await auth();
  const userId = session?.user?.id;
  const activities = userId ? await getActivities(userId, { limit: 500 }) : [];

  return <PaceDistributionChartClient data={getPaceDistribution(activities)} />;
}
