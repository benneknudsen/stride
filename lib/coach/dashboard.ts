// Stride — coach dashboard view models (issue #34). Pure builders that turn a
// user's activity history into the chart-ready, JSON-serializable data the
// /dashboard/coach sections render: the next-workout card + week strip, the
// pace-efficiency trend, the rolling zone distribution, the training-load gauge
// and the weekly volume bars.
//
// Everything here is pure — the clock is always a parameter — so the whole
// dashboard is unit-testable with fixture data. The server page decides what
// to cache (progression series, 1 h) vs. compute per request (workout card).

import type { PlannedSession } from "@/lib/coach/engine";
import {
  recommendWorkout,
  type WeekDay,
  type WorkoutRecommendation,
} from "@/lib/coach/recommender";
import { GOALS } from "@/lib/training/goals";
import type {
  LoadRisk,
  ProgressionActivityInput,
  ProgressionSnapshot,
  TrainingLoad,
} from "@/lib/training/progression";
import { computeProgression } from "@/lib/training/progression";
import { aggregateZones } from "@/lib/training/zones";
import type { HrZone } from "@/types/domain";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** Rolling window behind each zone-distribution bar: 4 weeks. */
const ROLLING_DAYS = 28;
/** Gauge scale: a 0–2.0 acute:chronic ratio spans the full arc. */
const GAUGE_MAX_RATIO = 2;

/** Weeks of history the dashboard charts — matches the demo fixtures' span. */
export const DASHBOARD_WEEKS = 6;

/** Activity input; `hrZones` is optional so demo fixtures fit unchanged. */
export type CoachActivityInput = Omit<ProgressionActivityInput, "hrZones"> & {
  hrZones?: HrZone[] | null;
};

/** Running activity types: "Run", "TrailRun", "VirtualRun", … */
function isRun(activity: CoachActivityInput): boolean {
  return /run/i.test(activity.type);
}

function normalize(activities: CoachActivityInput[]): ProgressionActivityInput[] {
  return activities.map((a) => ({ ...a, hrZones: a.hrZones ?? null }));
}

/** Short Danish-style day/month label, e.g. "15/7". */
function weekLabel(date: Date): string {
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

/** The end date of week `i` (0 = oldest) in a `weeks`-long series ending at `asOf`. */
function weekEnd(asOf: Date, weeks: number, i: number): Date {
  return new Date(asOf.getTime() - (weeks - 1 - i) * WEEK_MS);
}

// ── Pace-efficiency trend ───────────────────────────────────────────────────

export interface PacePoint {
  week: string;
  /** Median speed-per-heartbeat ×1000; null weeks render as a gap. */
  efficiency: number | null;
}

/** Line-chart points from a weekly progression series, oldest first. */
export function buildPaceEfficiencySeries(snapshots: ProgressionSnapshot[]): PacePoint[] {
  return snapshots.map((s) => ({
    week: weekLabel(s.date),
    efficiency: s.paceEfficiency,
  }));
}

// ── Zone distribution (stacked, rolling 4 weeks) ────────────────────────────

export interface ZoneWeek {
  week: string;
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
}

/**
 * One stacked bar per week: the zone split (percent of training time) over the
 * rolling 4 weeks ending that week. Weeks without HR data are all zeros.
 */
export function buildZoneSeries(
  activities: CoachActivityInput[],
  weeks: number,
  asOf: Date
): ZoneWeek[] {
  const runs = activities.filter(isRun);
  return Array.from({ length: weeks }, (_, i) => {
    const end = weekEnd(asOf, weeks, i);
    const windowRuns = runs.filter((run) => {
      const t = run.startDate.getTime();
      return t <= end.getTime() && t > end.getTime() - ROLLING_DAYS * DAY_MS;
    });
    const { slices } = aggregateZones(windowRuns);
    const bar: ZoneWeek = { week: weekLabel(end), z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
    for (const slice of slices) {
      bar[slice.meta.key] = Math.round(slice.percent * 10) / 10;
    }
    return bar;
  });
}

// ── Weekly volume ───────────────────────────────────────────────────────────

export interface VolumeWeek {
  week: string;
  km: number;
}

/** Running km per calendar-style 7-day bucket, oldest first. */
export function buildVolumeSeries(
  activities: CoachActivityInput[],
  weeks: number,
  asOf: Date
): VolumeWeek[] {
  const runs = activities.filter(isRun);
  return Array.from({ length: weeks }, (_, i) => {
    const end = weekEnd(asOf, weeks, i);
    const meters = runs
      .filter((run) => {
        const t = run.startDate.getTime();
        return t <= end.getTime() && t > end.getTime() - WEEK_MS;
      })
      .reduce((sum, run) => sum + run.distance, 0);
    return { week: weekLabel(end), km: Math.round(meters / 100) / 10 };
  });
}

// ── Training-load gauge ─────────────────────────────────────────────────────

/** The gauge's bands: every risk classification plus the no-data fallback. */
export type LoadRiskBand = LoadRisk | "unknown";

// `satisfies` keeps the value type the exact key set (no widening to a loose
// index signature) while forcing every band to be present and rejecting stray
// keys — stricter than a bare `Record<LoadRiskBand, string>` annotation.
export const LOAD_RISK_LABELS = {
  detraining: "Belastningen falder",
  optimal: "Optimal belastning",
  elevated: "Forhøjet belastning",
  high: "Høj skadesrisiko",
  unknown: "Utilstrækkelig data",
} satisfies Record<LoadRiskBand, string>;

export interface LoadGaugeView {
  /** Acute ÷ chronic load, or null with <4 weeks of history. */
  ratio: number | null;
  /** Gauge arc position, 0–1 (ratio 0–2 clamped). */
  fraction: number;
  risk: LoadRisk | null;
  /** Danish one-liner for the band. */
  label: string;
}

/** Gauge view for the acute:chronic training-load ratio. */
export function buildLoadGauge(load: TrainingLoad): LoadGaugeView {
  const { ratio, risk } = load;
  return {
    ratio,
    fraction: ratio === null ? 0 : Math.min(1, Math.max(0, ratio / GAUGE_MAX_RATIO)),
    risk,
    label: LOAD_RISK_LABELS[risk ?? "unknown"],
  };
}

// ── Week strip ──────────────────────────────────────────────────────────────

export interface WeekStripDay {
  weekday: PlannedSession["weekday"];
  type: PlannedSession["type"];
  description: string;
  isToday: boolean;
  isNext: boolean;
}

/**
 * The recommendation's Mon–Sun strip with today and the next session marked.
 * "Next" is the first run day at or after today; today itself counts when it
 * carries a run. Only rest left this week → nothing is marked next.
 */
export function buildWeekStrip(weekStrip: WeekDay[], now: Date): WeekStripDay[] {
  const todayIndex = (now.getDay() + 6) % 7;
  const nextIndex = weekStrip.findIndex((day, index) => index >= todayIndex && day.type !== "rest");
  return weekStrip.map((day, index) => ({
    weekday: day.weekday,
    type: day.type,
    description: day.description,
    isToday: index === todayIndex,
    isNext: index === nextIndex,
  }));
}

// ── The assembled dashboard ─────────────────────────────────────────────────

/** The workout card without its embedded week strip (rendered separately). */
export type WorkoutCardView = Omit<WorkoutRecommendation, "weekStrip">;

export interface CoachDashboardData {
  workout: WorkoutCardView;
  weekStrip: WeekStripDay[];
  paceSeries: PacePoint[];
  zoneSeries: ZoneWeek[];
  volumeSeries: VolumeWeek[];
  loadGauge: LoadGaugeView;
}

/**
 * Build the full coach dashboard from an activity history. Plain-JSON output:
 * safe to cache, serialize across the server→client boundary, and diff in tests.
 */
export function buildCoachDashboard(
  activities: CoachActivityInput[],
  now: Date,
  weeks: number = DASHBOARD_WEEKS
): CoachDashboardData {
  const normalized = normalize(activities);
  const snapshots = computeProgression(normalized, weeks, now);
  // computeProgression yields one snapshot per week, so this is only empty when
  // called with weeks < 1. Guard it: everything below dereferences `current`,
  // and an undefined slipping through would surface as a confusing later crash.
  const current = snapshots.at(-1);
  if (!current) {
    throw new Error(`buildCoachDashboard: weeks must be ≥ 1, got ${weeks}`);
  }

  const lastRun = normalized
    .filter(isRun)
    .filter((run) => run.startDate.getTime() <= now.getTime())
    .reduce<Date | null>(
      (latest, run) =>
        latest === null || run.startDate.getTime() > latest.getTime() ? run.startDate : latest,
      null
    );

  const { weekStrip, ...workout } = recommendWorkout(
    {
      userId: "demo",
      goal: GOALS.zone2,
      progression: current,
      lastRun: lastRun ?? new Date(now.getTime() - 3 * DAY_MS),
      footballYesterday: false,
    },
    now
  );

  return {
    workout,
    weekStrip: buildWeekStrip(weekStrip, now),
    paceSeries: buildPaceEfficiencySeries(snapshots),
    zoneSeries: buildZoneSeries(activities, weeks, now),
    volumeSeries: buildVolumeSeries(activities, weeks, now),
    loadGauge: buildLoadGauge(current.trainingLoad),
  };
}
