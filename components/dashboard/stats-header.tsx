import {
  demoActivities,
  formatDistance,
  formatPace,
  getWeeklyVolume,
} from "@/lib/demo/activities";
import { Card } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: string;
  unit: string;
  accent?: "volt" | "signal" | "aqua";
}

function StatCard({ label, value, unit, accent = "volt" }: StatCardProps) {
  const accentColor = {
    volt: "text-volt",
    signal: "text-signal",
    aqua: "text-aqua",
  }[accent];

  return (
    <Card className="flex-1">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
        {label}
      </p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`tabular text-3xl font-semibold ${accentColor}`}>
          {value}
        </span>
        <span className="text-sm text-sub">{unit}</span>
      </div>
    </Card>
  );
}

export async function StatsHeader() {
  await new Promise((r) => setTimeout(r, 800));

  const thisWeekVolume = getWeeklyVolume(demoActivities, 0);

  const recentRuns = demoActivities.slice(0, 7);
  const avgPace =
    recentRuns.reduce((sum, a) => sum + a.avgPace, 0) / recentRuns.length;
  const totalDistance = demoActivities.reduce((sum, a) => sum + a.distance, 0);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        label="This Week"
        value={formatDistance(thisWeekVolume)}
        unit="km"
        accent="volt"
      />
      <StatCard
        label="Avg Pace (7d)"
        value={formatPace(avgPace)}
        unit="/km"
        accent="volt"
      />
      <StatCard
        label="Total Distance"
        value={formatDistance(totalDistance)}
        unit="km"
        accent="volt"
      />
    </div>
  );
}
