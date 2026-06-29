// Stride — typed data layer for the committed training dashboard.
//
// Today these are seeded mock runs so the dashboard renders without a Strava
// connection (see the demo-mode note in CLAUDE.md). The shapes below are the
// contract the UI reads against — swap `getTrainingData` for a real Strava
// query later and every section keeps working unchanged.

import type { Goal, GoalKey, ZoneKey } from "./goals";
import { LATEST_RUN, PAST_RUNS } from "./mock-runs";

export { NEXT_INDEX, TODAY_INDEX } from "./mock-runs";

/** The most recent run, with the detail the "01 Latest run" card needs. */
export interface LatestRun {
  title: string;
  /** human "when" label, e.g. "Today, 7:02 AM" */
  when: string;
  distanceKm: number;
  /** elapsed time label, e.g. "52:18" */
  duration: string;
  /** pace label per km, e.g. "5:08" */
  pace: string;
  avgHr: number;
  cadence: number;
  /** elevation gain in metres */
  elevGain: number;
  /** evenly-spaced pace samples (lower = faster) for the pace-over-distance trace */
  paceTrace: number[];
  /** share of moving time spent in each zone — sums to ~100 */
  zoneDistribution: Record<ZoneKey, number>;
}

/** One bar in the "02 Last 5 runs" trend chart. */
export interface PastRun {
  day: string;
  distanceKm: number;
  pace: string;
  /** dominant zone for the run — drives the bar colour */
  zone: ZoneKey;
}

/** A trend chip above the last-5 chart. */
export interface TrendStat {
  label: string;
  value: string;
  delta: string;
  direction: "up" | "down" | "flat";
}

/** One of the three "why this run" drivers under section 03. */
export interface NextRunDriver {
  key: "recovery" | "trend" | "plan";
  label: string;
  value: string;
}

/** Everything the dashboard reads that is NOT already on the `Goal`. */
export interface TrainingData {
  latest: LatestRun;
  runs: PastRun[];
  trend: TrendStat[];
  drivers: NextRunDriver[];
}

/**
 * Assemble the dashboard dataset for a goal. Most of it is plan-independent
 * mock data; the Zone-2 adherence chip and the "Plan" driver adapt to the
 * committed goal so the view feels personalised.
 */
export function getTrainingData(goal: Goal): TrainingData {
  const trend: TrendStat[] = [
    { label: "Weekly volume", value: "42 km", delta: "+8%", direction: "up" },
    { label: "Avg pace", value: "5:12/km", delta: "-3%", direction: "up" },
    isZone2Plan(goal.key)
      ? { label: "Zone 2 adherence", value: "82%", delta: "+6%", direction: "up" }
      : { label: "Zone 2 adherence", value: "74%", delta: "0%", direction: "flat" },
  ];

  const drivers: NextRunDriver[] = [
    { key: "recovery", label: "Recovery", value: "2 rest days · fresh" },
    { key: "trend", label: "Trend", value: "Load +8% this week" },
    { key: "plan", label: "Plan", value: goal.short },
  ];

  return { latest: LATEST_RUN, runs: PAST_RUNS, trend, drivers };
}

function isZone2Plan(key: GoalKey): boolean {
  return key === "zone2";
}
