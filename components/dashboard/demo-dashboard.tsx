"use client";

import { ActivityRow } from "@/components/dashboard/activity-row";
import { AnalysisPanel } from "@/components/dashboard/analysis-panel";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { demoActivities } from "@/lib/demo/data";
import {
  formatDistance,
  formatPace,
  getPaceDistribution,
  getSummaryStats,
  getWeeklyVolumeSeries,
} from "@/lib/metrics";
import { aggregateZones } from "@/lib/training/zones";
import { PaceDistributionChartClient } from "./pace-distribution-chart.client";
import { WeeklyVolumeChartClient } from "./weekly-volume-chart.client";
import { ZoneBreakdownChartClient } from "./zone-breakdown-chart.client";

/**
 * The dashboard rendered entirely from local demo fixtures — no auth, no DB.
 * Reuses the exact presentational components and metric helpers as the live
 * dashboard so demo and real views look identical.
 */
export function DemoDashboard() {
  const { thisWeekVolume, avgPace, totalDistance } = getSummaryStats(demoActivities);
  const weeklyVolume = getWeeklyVolumeSeries(demoActivities, 12);
  const paceDistribution = getPaceDistribution(demoActivities);
  const zoneBreakdown = aggregateZones(demoActivities);
  const recentActivities = demoActivities.slice(0, 8);

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-fg">Dashboard</h1>
        <p className="mt-1 text-sub">Your training at a glance</p>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="This Week"
            value={formatDistance(thisWeekVolume)}
            unit="km"
            accent="volt"
          />
          <StatCard label="Avg Pace (7d)" value={formatPace(avgPace)} unit="/km" accent="volt" />
          <StatCard
            label="Total Distance"
            value={formatDistance(totalDistance)}
            unit="km"
            accent="volt"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <WeeklyVolumeChartClient data={weeklyVolume} />
          <PaceDistributionChartClient data={paceDistribution} />
        </div>

        <ZoneBreakdownChartClient breakdown={zoneBreakdown} />

        <AnalysisPanel activities={demoActivities} scope="overall" />

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
      </div>
    </main>
  );
}
