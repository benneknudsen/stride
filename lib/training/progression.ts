// Stride — progression metrics engine (issue #30). Pure calculation layer that
// turns a user's running history into trend metrics: pace efficiency, HR drift
// stability, acute:chronic training load, zone-2 share, and rolling volume.
// The foundation every coach decision builds on.
//
// Design rules (from the issue):
//   - Never guess: with less than 4 weeks of history a metric is `null`.
//   - Missing HR data skips the HR-based metrics, the rest still compute.
//   - Outlier-resistant: aggregates are median-based, not mean-based.
//
// The core (`computeSnapshot`, `computeProgression`) is pure and synchronous so
// it can be unit-tested with fixture data; `getProgression` and
// `getCurrentProgression` are the thin DB-backed wrappers.

import { getActivities } from "@/lib/db/queries";
import { aggregateZones } from "@/lib/training/zones";
import type { HrZone } from "@/types/domain";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rolling analysis window: 4 weeks. */
const WINDOW_DAYS = 28;
/** Acute training-load window: 7 days. */
const ACUTE_DAYS = 7;
/** A "long run" for HR-drift purposes: 12 km or more. */
const LONG_RUN_METERS = 12_000;

/** Minimal activity shape the engine reads — a subset of an activities row. */
export interface ProgressionActivityInput {
  /** Strava activity type, e.g. "Run", "TrailRun", "Ride". */
  type: string;
  /** Distance in meters. */
  distance: number;
  /** Moving time in seconds. */
  movingTime: number;
  /** Average heart rate in bpm, if recorded. */
  averageHeartrate: number | null;
  /** Time-in-zone buckets, if Strava provided them. */
  hrZones: HrZone[] | null;
  /** Activity start (UTC). */
  startDate: Date;
}

/** Overload-risk band derived from the acute:chronic load ratio. */
export type LoadRisk = "detraining" | "optimal" | "elevated" | "high";

export interface TrainingLoad {
  /** Average daily running minutes over the last 7 days. */
  acute: number;
  /** Average daily running minutes over the last 28 days; null if <4 weeks of data. */
  chronic: number | null;
  /** Acute ÷ chronic. Null when chronic is unknown or zero. */
  ratio: number | null;
  /** Risk band for the ratio. Null when the ratio is unknown. */
  risk: LoadRisk | null;
}

/** All progression metrics evaluated at a single point in time. */
export interface ProgressionSnapshot {
  /** The moment the rolling windows end at. */
  date: Date;
  /** True when at least 4 weeks of history exist before `date`. */
  hasFullWindow: boolean;
  /**
   * Median speed per heartbeat over the 4-week window, scaled ×1000
   * ((m/s ÷ bpm) × 1000). Higher = faster at the same effort. Null without a
   * full window or without any HR-carrying run.
   */
  paceEfficiency: number | null;
  /**
   * 0–100 consistency of HR-per-pace across the window's long runs (≥12 km).
   * 100 = identical aerobic cost on every long run. Null with fewer than two
   * HR-carrying long runs or without a full window.
   */
  hrStability: number | null;
  trainingLoad: TrainingLoad;
  /** Share of window training time spent in zone 2 (0–100). Null without HR data. */
  zone2Percent: number | null;
  /** Total running distance over the 4-week window, in km. Null without a full window. */
  volumeKm: number | null;
  /** Whether the load ratio says the athlete can safely add volume. Null when unknown. */
  readyToIncrease: boolean | null;
}

/** Running activity types: "Run", "TrailRun", "VirtualRun", … */
function isRun(activity: ProgressionActivityInput): boolean {
  return /run/i.test(activity.type);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function inWindow(activity: ProgressionActivityInput, asOf: Date, days: number): boolean {
  const time = activity.startDate.getTime();
  return time <= asOf.getTime() && time >= asOf.getTime() - days * DAY_MS;
}

function classifyRisk(ratio: number): LoadRisk {
  if (ratio < 0.8) return "detraining";
  if (ratio <= 1.3) return "optimal";
  if (ratio <= 1.5) return "elevated";
  return "high";
}

/**
 * Median speed-per-heartbeat across the window's HR-carrying runs. Median so a
 * single GPS glitch or HR-strap dropout can't bend the trend.
 */
function paceEfficiency(windowRuns: ProgressionActivityInput[]): number | null {
  const efficiencies = windowRuns
    .filter((run) => (run.averageHeartrate ?? 0) > 0 && run.movingTime > 0 && run.distance > 0)
    .map((run) => (run.distance / run.movingTime / (run.averageHeartrate as number)) * 1000);
  return efficiencies.length > 0 ? median(efficiencies) : null;
}

/**
 * HR-drift stability across long runs: computes each long run's aerobic cost
 * (bpm per m/s) and scores how tightly they cluster, via median absolute
 * deviation relative to the median. Identical cost on every long run → 100.
 */
function hrStability(windowRuns: ProgressionActivityInput[]): number | null {
  const costs = windowRuns
    .filter(
      (run) =>
        run.distance >= LONG_RUN_METERS && (run.averageHeartrate ?? 0) > 0 && run.movingTime > 0
    )
    .map((run) => (run.averageHeartrate as number) / (run.distance / run.movingTime));
  if (costs.length < 2) return null;

  const mid = median(costs);
  if (mid === 0) return null;
  const mad = median(costs.map((cost) => Math.abs(cost - mid)));
  return Math.max(0, Math.round(100 * (1 - (5 * mad) / mid)));
}

/** Average daily running minutes over the trailing `days`. */
function dailyLoad(runs: ProgressionActivityInput[], asOf: Date, days: number): number {
  const totalSeconds = runs
    .filter((run) => inWindow(run, asOf, days))
    .reduce((sum, run) => sum + run.movingTime, 0);
  return totalSeconds / 60 / days;
}

/** Compute every progression metric at a single point in time. */
export function computeSnapshot(
  activities: ProgressionActivityInput[],
  asOf: Date
): ProgressionSnapshot {
  const runs = activities.filter(isRun).filter((run) => run.startDate.getTime() <= asOf.getTime());
  const windowRuns = runs.filter((run) => inWindow(run, asOf, WINDOW_DAYS));

  const earliest = runs.reduce<number | null>(
    (min, run) => (min === null ? run.startDate.getTime() : Math.min(min, run.startDate.getTime())),
    null
  );
  const hasFullWindow = earliest !== null && asOf.getTime() - earliest >= WINDOW_DAYS * DAY_MS;

  const acute = dailyLoad(runs, asOf, ACUTE_DAYS);
  const chronic = hasFullWindow ? dailyLoad(runs, asOf, WINDOW_DAYS) : null;
  const ratio = chronic !== null && chronic > 0 ? acute / chronic : null;
  const risk = ratio !== null ? classifyRisk(ratio) : null;

  const zoneBreakdown = hasFullWindow ? aggregateZones(windowRuns) : null;
  const zone2Percent =
    zoneBreakdown && zoneBreakdown.totalSeconds > 0
      ? (zoneBreakdown.slices.find((slice) => slice.meta.zone === 2)?.percent ?? null)
      : null;

  return {
    date: asOf,
    hasFullWindow,
    paceEfficiency: hasFullWindow ? paceEfficiency(windowRuns) : null,
    hrStability: hasFullWindow ? hrStability(windowRuns) : null,
    trainingLoad: { acute, chronic, ratio, risk },
    zone2Percent,
    volumeKm: hasFullWindow ? windowRuns.reduce((sum, run) => sum + run.distance, 0) / 1000 : null,
    readyToIncrease: risk !== null ? risk === "optimal" : null,
  };
}

/**
 * Weekly snapshot series: `weeks` snapshots at 7-day intervals, oldest first,
 * ending exactly at `asOf`.
 */
export function computeProgression(
  activities: ProgressionActivityInput[],
  weeks: number,
  asOf: Date
): ProgressionSnapshot[] {
  return Array.from({ length: weeks }, (_, i) => {
    const date = new Date(asOf.getTime() - (weeks - 1 - i) * 7 * DAY_MS);
    return computeSnapshot(activities, date);
  });
}

/**
 * Fetch enough history to cover `weeks` of snapshots plus each one's 4-week
 * window, and one extra window beyond that. The margin is what lets
 * `hasFullWindow` flip true: it needs a run OLDER than the oldest snapshot's
 * window, and fetching exactly to the window edge would make the earliest
 * fetched run at most `WINDOW_DAYS` old — leaving the flag permanently false.
 */
async function fetchRuns(userId: string, weeks: number, asOf: Date) {
  const from = new Date(asOf.getTime() - (weeks * 7 + 2 * WINDOW_DAYS) * DAY_MS);
  const rows = await getActivities(userId, { from, to: asOf, limit: 1000 });
  return (rows as ProgressionActivityInput[]).filter(isRun);
}

/** Progression time series for a user: one snapshot per week, oldest first. */
export async function getProgression(userId: string, weeks = 12): Promise<ProgressionSnapshot[]> {
  const asOf = new Date();
  return computeProgression(await fetchRuns(userId, weeks, asOf), weeks, asOf);
}

/** The user's progression right now — a single up-to-date snapshot. */
export async function getCurrentProgression(userId: string): Promise<ProgressionSnapshot> {
  const asOf = new Date();
  return computeSnapshot(await fetchRuns(userId, 0, asOf), asOf);
}
