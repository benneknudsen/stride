import { Suspense } from "react";
import { ActivityList } from "@/components/dashboard/activity-list";
import { LoadingCard } from "@/components/dashboard/loading-card";
import { PaceDistributionChart } from "@/components/dashboard/pace-distribution-chart";
import { StatsHeader } from "@/components/dashboard/stats-header";
import { WeeklyVolumeChart } from "@/components/dashboard/weekly-volume-chart";

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
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
          <StatsHeader />
        </Suspense>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <WeeklyVolumeChart />
          <PaceDistributionChart />
        </div>

        <Suspense fallback={<LoadingCard label="Analysing your runs…" />}>
          <ActivityList />
        </Suspense>
      </div>
    </main>
  );
}
