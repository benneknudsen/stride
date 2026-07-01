import { StatCard } from "@/components/dashboard/stat-card";
import type { DashboardActivity } from "@/lib/db/queries";
import { formatDistance, formatPace, getSummaryStats } from "@/lib/metrics";

export function StatsHeader({ activities }: { activities: DashboardActivity[] }) {
  const { thisWeekVolume, avgPace, totalDistance } = getSummaryStats(activities);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard label="This Week" value={formatDistance(thisWeekVolume)} unit="km" accent="volt" />
      <StatCard label="Avg Pace (7d)" value={formatPace(avgPace)} unit="/km" accent="volt" />
      <StatCard
        label="Total Distance"
        value={formatDistance(totalDistance)}
        unit="km"
        accent="volt"
      />
    </div>
  );
}
