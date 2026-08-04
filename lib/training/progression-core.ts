// Stride — progression metrics engine (issue #30), pure core. Turns a running
// history into trend metrics: pace efficiency, HR drift stability,
// acute:chronic training load, zone-2 share, and rolling volume. The
// foundation every coach decision builds on.
//
// Design rules (from the issue):
//   - Never guess: with less than 4 weeks of history a metric is `null`.
//   - Missing HR data skips the HR-based metrics, the rest still compute.
//   - Outlier-resistant: aggregates are median-based, not mean-based.
//
// This module is pure and synchronous — no DB, no Next.js — so the Cobalt
// view-models (which client components import) can share the exact engine the
// server uses without dragging lib/db into the browser bundle. The DB-backed
// wrappers live in lib/training/progression.ts, which re-exports everything
// here.

import { ensureDate } from "@/lib/db/calendar-date";
import { aggregateZones } from "@/lib/training/zones";
import type { HrZone } from "@/types/domain";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rolling analysis window: 4 weeks. */
export const WINDOW_DAYS = 28;
/** A "long run" for HR-drift purposes: 12 km or more. */
const LONG_RUN_METERS = 12_000;

// ── EWMA training load (issue #246) ─────────────────────────────────────────
// Acute (ATL) and chronic (CTL) load are exponentially-weighted moving averages
// of each day's running load, updated once per calendar day:
//
//   ATL(d) = ATL(d-1) * (1 - 1/TAU_ACUTE)   + load(d) * (1/TAU_ACUTE)
//   CTL(d) = CTL(d-1) * (1 - 1/TAU_CHRONIC) + load(d) * (1/TAU_CHRONIC)
//
// Both series start at 0 and build forward from the first activity, so load is
// available from day one instead of being gated on 4 weeks of history. The
// smaller acute tau makes ATL react faster to recent work; the larger chronic
// tau makes CTL a slow-moving fitness baseline. Every calendar day between the
// first activity and the snapshot is processed — including zero-activity days,
// which decay both series toward 0. `dailyLoad` is a day's total *running
// moving minutes* (the only reliable signal today; no intensity weighting).
//
// Tune the responsiveness here — these are the standard 7/42-day constants.
/** EWMA smoothing constant for acute load (fast response). */
export const TAU_ACUTE = 7;
/** EWMA smoothing constant for chronic load (slow baseline). */
export const TAU_CHRONIC = 42;

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
  /**
   * Activity start (UTC). `string` is not a convenience — the Neon driver hands
   * `timestamp` columns back as ISO strings, so a DB row genuinely carries one.
   * Typing it as `Date` alone made the compiler bless `startDate.getTime()` on a
   * string, which is the bug behind #190/#194/#195. Every read must go through
   * `ensureDate`; the widened type is what forces that.
   */
  startDate: Date | string;
}

/** Overload-risk band derived from the acute:chronic load ratio. */
export type LoadRisk = "detraining" | "optimal" | "elevated" | "high";

export interface TrainingLoad {
  /**
   * Acute training load (ATL): EWMA of daily running minutes with a 7-day tau.
   * Reacts fast to recent work. 0 before the first activity.
   */
  acute: number;
  /**
   * Chronic training load (CTL): EWMA of daily running minutes with a 42-day
   * tau — the slow fitness baseline. Null only before the first activity, when
   * no base exists yet (it is no longer gated on a full 4-week window).
   */
  chronic: number | null;
  /** Acute ÷ chronic (ATL/CTL). Null only when chronic (CTL) is zero. */
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
export function isRun(activity: ProgressionActivityInput): boolean {
  return /run/i.test(activity.type);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function inWindow(activity: ProgressionActivityInput, asOf: Date, days: number): boolean {
  const time = ensureDate(activity.startDate).getTime();
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

/** Floor a timestamp to its UTC calendar-day index (whole days since epoch). */
function dayIndex(time: number): number {
  return Math.floor(time / DAY_MS);
}

interface EwmaLoad {
  /** Acute load (ATL), average running minutes/day, fast tau. */
  acute: number;
  /** Chronic load (CTL), average running minutes/day, slow tau. */
  chronic: number;
}

/**
 * Acute (ATL) and chronic (CTL) EWMA load at `asOf`, in running minutes/day.
 *
 * Buckets every run into its UTC calendar day, then walks day-by-day from the
 * first activity through `asOf`, applying the EWMA recurrence once per day.
 * Zero-activity days still advance the recurrence, so both series decay across
 * gaps. Before the first activity there is no base: returns {0, 0}.
 *
 * `runs` are assumed already filtered to runs dated at/before `asOf`.
 */
function ewmaLoad(runs: ProgressionActivityInput[], asOf: Date): EwmaLoad {
  const asOfDay = dayIndex(asOf.getTime());
  const minutesByDay = new Map<number, number>();
  let firstDay: number | null = null;

  for (const run of runs) {
    const day = dayIndex(ensureDate(run.startDate).getTime());
    if (day > asOfDay) continue; // defensive — runs are pre-filtered to <= asOf
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + run.movingTime / 60);
    firstDay = firstDay === null ? day : Math.min(firstDay, day);
  }
  if (firstDay === null) return { acute: 0, chronic: 0 };

  let acute = 0;
  let chronic = 0;
  for (let day = firstDay; day <= asOfDay; day++) {
    const load = minutesByDay.get(day) ?? 0;
    acute = acute * (1 - 1 / TAU_ACUTE) + load / TAU_ACUTE;
    chronic = chronic * (1 - 1 / TAU_CHRONIC) + load / TAU_CHRONIC;
  }
  return { acute, chronic };
}

/** Compute every progression metric at a single point in time. */
export function computeSnapshot(
  activities: ProgressionActivityInput[],
  asOf: Date
): ProgressionSnapshot {
  const runs = activities
    .filter(isRun)
    .filter((run) => ensureDate(run.startDate).getTime() <= asOf.getTime());
  const windowRuns = runs.filter((run) => inWindow(run, asOf, WINDOW_DAYS));

  const earliest = runs.reduce<number | null>((min, run) => {
    const time = ensureDate(run.startDate).getTime();
    return min === null ? time : Math.min(min, time);
  }, null);
  const hasFullWindow = earliest !== null && asOf.getTime() - earliest >= WINDOW_DAYS * DAY_MS;

  // EWMA load (issue #246) builds from the first activity, independent of the
  // 4-week window that still gates the trend metrics below. `chronic` (CTL) is
  // null only before any activity exists, and the ratio is null exactly then.
  const { acute, chronic: ctl } = ewmaLoad(runs, asOf);
  const chronic = ctl > 0 ? ctl : null;
  const ratio = chronic !== null ? acute / chronic : null;
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
    // Gated on the full window (like the other trend metrics): the "can I add
    // volume?" call stays null until there's a 4-week base, even though the raw
    // EWMA risk is now available sooner.
    readyToIncrease: hasFullWindow && risk !== null ? risk === "optimal" : null,
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
