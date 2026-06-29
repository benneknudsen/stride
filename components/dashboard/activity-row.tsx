import Link from "next/link";
import { ZoneBadge } from "@/components/dashboard/zone-badge";
import { formatDistance, formatDuration, formatPace } from "@/lib/metrics";

export interface ActivityRowData {
  id: string;
  name: string;
  startDate: Date;
  distance: number;
  movingTime: number;
  averageSpeed: number | null;
  averageHeartrate: number | null;
  averageCadence: number | null;
}

/**
 * One activity line on the dashboard. When `href` is given the row links to the
 * activity detail page; demo activities omit it (they have no DB-backed detail
 * page) and render as a static row.
 */
export function ActivityRow({ activity, href }: { activity: ActivityRowData; href?: string }) {
  const date = new Date(activity.startDate);
  const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const inner = (
    <div className="flex items-center justify-between border-b border-border py-4 last:border-0">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="font-medium text-fg">{activity.name}</span>
          <ZoneBadge averageHeartrate={activity.averageHeartrate} />
        </span>
        <span className="text-xs text-muted">
          {dayName}, {dateStr}
        </span>
      </div>
      <div className="flex items-center gap-3 sm:gap-6 text-right">
        <div className="flex flex-col gap-0.5">
          <span className="tabular text-sm font-medium text-fg">
            {formatDistance(activity.distance)} km
          </span>
          <span className="tabular text-xs text-muted">{formatDuration(activity.movingTime)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="tabular text-sm font-medium text-volt">
            {formatPace(activity.averageSpeed)}
          </span>
          <span className="text-xs text-muted">/km</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="tabular text-sm font-medium text-signal">
            {activity.averageHeartrate ? Math.round(activity.averageHeartrate) : "--"}
          </span>
          <span className="text-xs text-muted">bpm</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="tabular text-sm font-medium text-aqua">
            {activity.averageCadence ? Math.round(activity.averageCadence * 2) : "--"}
          </span>
          <span className="text-xs text-muted">spm</span>
        </div>
      </div>
    </div>
  );

  if (!href) {
    return <div className="block rounded-lg">{inner}</div>;
  }

  return (
    <Link href={href} className="block rounded-lg transition-colors hover:bg-bg-2">
      {inner}
    </Link>
  );
}
