import { CircleCheck } from "lucide-react";
import { Suspense } from "react";
import { ActivityList } from "@/components/dashboard/activity-list";
import { AnalysisSection } from "@/components/dashboard/analysis-section";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { LoadingCard } from "@/components/dashboard/loading-card";
import { PaceDistributionChart } from "@/components/dashboard/pace-distribution-chart";
import { StatsHeader } from "@/components/dashboard/stats-header";
import { WeeklyVolumeChart } from "@/components/dashboard/weekly-volume-chart";
import { ZoneBreakdownChart } from "@/components/dashboard/zone-breakdown-chart";
import { auth } from "@/lib/auth";
import { getDashboardActivities, getStravaTokens } from "@/lib/db/queries";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ strava_connected?: string }>;
}) {
  const { strava_connected } = await searchParams;

  // One column-projected read (≤500 rows) feeds every dashboard section, instead
  // of six components each re-querying overlapping windows of the same table.
  const session = await auth();
  const userId = session?.user?.id;
  const [activities, tokens] = userId
    ? await Promise.all([getDashboardActivities(userId), getStravaTokens(userId)])
    : [[], null];
  const stravaConnected = tokens !== null;

  // Weekly-volume buckets span the last 12 weeks; bound that section's slice by
  // the same window the dedicated query used to enforce.
  const weeklyVolumeFrom = new Date();
  weeklyVolumeFrom.setDate(weeklyVolumeFrom.getDate() - 12 * 7);

  return (
    <DashboardView>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        {strava_connected === "true" && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-volt/30 bg-volt/10 px-4 py-3 text-sm text-volt">
            <CircleCheck className="size-4" />
            Strava connected — your activities will sync shortly.
          </div>
        )}

        <div className="mb-8">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-fg">Dashboard</h1>
          <p className="mt-1 text-sub">Your training at a glance</p>
        </div>

        <div className="space-y-6">
          <Suspense
            fallback={
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <LoadingCard label="Loading stats…" className="min-h-[120px]" />
                <LoadingCard label="Loading stats…" className="min-h-[120px]" />
                <LoadingCard label="Loading stats…" className="min-h-[120px]" />
              </div>
            }
          >
            <StatsHeader activities={activities.slice(0, 30)} />
          </Suspense>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <WeeklyVolumeChart activities={activities} from={weeklyVolumeFrom} />
            <PaceDistributionChart activities={activities} />
          </div>

          <Suspense fallback={<LoadingCard label="Mapping your zones…" />}>
            <ZoneBreakdownChart activities={activities} />
          </Suspense>

          <Suspense fallback={<LoadingCard label="Generating insights…" />}>
            <AnalysisSection activities={activities.slice(0, 60)} />
          </Suspense>

          <Suspense fallback={<LoadingCard label="Analysing your runs…" />}>
            <ActivityList activities={activities.slice(0, 8)} stravaConnected={stravaConnected} />
          </Suspense>
        </div>
      </main>
    </DashboardView>
  );
}
