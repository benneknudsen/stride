import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActivityMap } from "@/components/activity/activity-map";
import { HrZonesChart } from "@/components/activity/hr-zones-chart";
import { SplitsTable } from "@/components/activity/splits-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getActivityById } from "@/lib/db/queries";
import { formatDistance, formatDuration, formatPace } from "@/lib/metrics";
import type { HrZone, Split } from "@/types/domain";

interface StatProps {
  label: string;
  value: string;
  unit?: string;
  accent?: "fg" | "volt" | "signal" | "aqua";
}

function Stat({ label, value, unit, accent = "fg" }: StatProps) {
  const accentColor = {
    fg: "text-fg",
    volt: "text-volt",
    signal: "text-signal",
    aqua: "text-aqua",
  }[accent];

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className={`tabular text-2xl font-semibold ${accentColor}`}>{value}</span>
        {unit && <span className="text-sm text-sub">{unit}</span>}
      </span>
    </div>
  );
}

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/");
  }

  const activity = await getActivityById(userId, id);

  if (!activity) {
    notFound();
  }

  const splits = activity.splits as Split[] | null;
  const hrZones = activity.hrZones as HrZone[] | null;

  const date = new Date(activity.startDate).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        Back to Dashboard
      </Link>

      <div className="mt-6 mb-8">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-fg">
          {activity.name}
        </h1>
        <p className="mt-1 text-sub">
          {activity.type} · {date}
        </p>
      </div>

      <Card hover={false} className="mb-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Distance"
            value={formatDistance(activity.distance)}
            unit="km"
            accent="volt"
          />
          <Stat label="Duration" value={formatDuration(activity.movingTime)} />
          <Stat
            label="Avg Pace"
            value={formatPace(activity.averageSpeed)}
            unit="/km"
            accent="volt"
          />
          <Stat
            label="Avg HR"
            value={activity.averageHeartrate ? `${Math.round(activity.averageHeartrate)}` : "--"}
            unit="bpm"
            accent="signal"
          />
          <Stat
            label="Max HR"
            value={activity.maxHeartrate ? `${Math.round(activity.maxHeartrate)}` : "--"}
            unit="bpm"
            accent="signal"
          />
          <Stat
            label="Cadence"
            value={activity.averageCadence ? `${Math.round(activity.averageCadence * 2)}` : "--"}
            unit="spm"
            accent="aqua"
          />
        </div>
        <div className="mt-6 border-t border-border pt-4">
          <Stat
            label="Elevation Gain"
            value={`${Math.round(activity.totalElevationGain)}`}
            unit="m"
          />
        </div>
      </Card>

      <div className="space-y-6">
        <Card hover={false}>
          <CardHeader>
            <CardTitle>Route</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityMap summaryPolyline={activity.summaryPolyline} />
          </CardContent>
        </Card>

        <Card hover={false}>
          <CardHeader>
            <CardTitle>Splits</CardTitle>
          </CardHeader>
          <CardContent>
            <SplitsTable splits={splits} />
          </CardContent>
        </Card>

        <Card hover={false}>
          <CardHeader>
            <CardTitle>Heart Rate Zones</CardTitle>
          </CardHeader>
          <CardContent>
            <HrZonesChart hrZones={hrZones} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
