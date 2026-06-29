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
    <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border py-3.5 last:border-0">
      {/* Left: name + date + zone */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="flex items-center gap-2">
          <span className="font-medium text-fg text-sm truncate">{activity.name}</span>
          <ZoneBadge averageHeartrate={activity.averageHeartrate} />
        </span>
        <span className="text-xs text-muted">
          {dayName}, {dateStr}
        </span>
      </div>

      {/* Right: metrics — fixed column widths for alignment */}
      <div className="flex items-center gap-0 text-sm">
        <span className="tabular w-16 text-right">
          <span className="font-medium text-fg">{formatDistance(activity.distance)}</span>
          <span className="text-xs text-muted ml-0.5">km</span>
        </span>
        <span className="tabular w-14 text-right ml-5">
          <span className="font-medium text-fg">{formatDuration(activity.movingTime)}</span>
        </span>
        <span className="tabular w-14 text-right ml-5">
          <span className="font-medium text-volt">{formatPace(activity.averageSpeed)}</span>
        </span>
        <span className="tabular w-11 text-right ml-5">
          <span className="font-medium text-signal">{activity.averageHeartrate ? Math.round(activity.averageHeartrate) : "--"}</span>
        </span>
        <span className="tabular w-11 text-right ml-5">
          <span className="font-medium text-aqua">{activity.averageCadence ? Math.round(activity.averageCadence * 2) : "--"}</span>
        </span>
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
