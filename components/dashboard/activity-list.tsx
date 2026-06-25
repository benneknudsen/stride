import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type Activity,
  demoActivities,
  formatDistance,
  formatDuration,
  formatPace,
} from "@/lib/demo/activities";

function ActivityRow({ activity }: { activity: Activity }) {
  const date = new Date(activity.date);
  const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex items-center justify-between border-b border-border py-4 last:border-0">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-fg">{activity.name}</span>
        <span className="text-xs text-muted">
          {dayName}, {dateStr}
        </span>
      </div>
      <div className="flex items-center gap-6 text-right">
        <div className="flex flex-col gap-0.5">
          <span className="tabular text-sm font-medium text-fg">
            {formatDistance(activity.distance)} km
          </span>
          <span className="tabular text-xs text-muted">{formatDuration(activity.duration)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="tabular text-sm font-medium text-volt">
            {formatPace(activity.avgPace)}
          </span>
          <span className="text-xs text-muted">/km</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="tabular text-sm font-medium text-signal">{activity.avgHeartRate}</span>
          <span className="text-xs text-muted">bpm</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="tabular text-sm font-medium text-aqua">{activity.avgCadence}</span>
          <span className="text-xs text-muted">spm</span>
        </div>
      </div>
    </div>
  );
}

export async function ActivityList() {
  await new Promise((r) => setTimeout(r, 1200));

  const recentActivities = demoActivities.slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activities</CardTitle>
      </CardHeader>
      <CardContent>
        {recentActivities.map((activity) => (
          <ActivityRow key={activity.id} activity={activity} />
        ))}
      </CardContent>
    </Card>
  );
}
