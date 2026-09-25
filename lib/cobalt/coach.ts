// Cobalt Glass — Coach view-model.
// Pure derivation (no React) from activity data, mirroring lib/cobalt/hjem.ts
// and lib/cobalt/aktiviteter.ts, so the same presentational cards render demo
// and live data. Day-granular bucketing keeps the server render and client
// hydration in agreement.
//
// Two builders share the CoachView shape:
//   - buildCoachView()      — the demo fallback: fixture numbers for visitors.
//   - buildLiveCoachView()  — the authenticated path: form and load are derived
//                             from the coach dashboard (recommender +
//                             progression engine) instead of fixtures.
//
// The coach is a deterministic engine, not a conversation: it states what the
// athlete's own numbers say and never asks anything back.

import type { CoachDashboardData } from "@/lib/coach/dashboard";
import { EASY_MIN_RECOVERY_HOURS } from "@/lib/coach/engine";
import {
  type Readiness,
  readinessFromRatio,
  readinessWithRecovery,
  SAME_DAY_RUN_NOTE,
} from "@/lib/cobalt/readiness";
import { ensureDate } from "@/lib/db/calendar-date";
import { demoActivities } from "@/lib/demo/data";
import { getWeeklyVolume } from "@/lib/metrics";
import { hoursSinceHardEffort, hoursSinceLastRun } from "@/lib/training/effort";
import { computeSnapshot } from "@/lib/training/progression-core";

const DAY_MS = 86_400_000;

interface LoadBar {
  /** Day index 0 (13 days ago) → 13 (today). */
  id: string;
  /** Relative bar height 0–1. */
  fraction: number;
  /** The final bar (today) reads red; the rest are cobalt. */
  accent: boolean;
}

export interface CoachView {
  /** Header count — "COACH · BASERET PÅ N TURE". */
  activityCount: number;
  /** "Ugens fokus" — the week's headline recommendation (serif quote). */
  focusQuote: string;
  form: {
    /** Readiness percentage (e.g. 86). */
    pct: number;
    /** Plain-language note, e.g. "Klar til hårdt pas". */
    note: string;
    /**
     * The #273 same-day override: set when the newest run sits inside the 24 h
     * recovery window *and* the load-derived read is in the ready band. The
     * gauge above keeps its load-derived number and band note — this line sits
     * under them so the card can't promise "Klar til hårdt pas" hours after the
     * runner was actually out.
     */
    sameDayNote?: string;
    /** Trend chip, mono uppercase: "STIGENDE" / "STABIL" / "FALDENDE". */
    trend: string;
    /** Red when falling, else cobalt. */
    trendTone: "cobalt" | "red";
  };
  load: {
    /** 14 daily acute-load bars, oldest → newest. */
    bars: LoadBar[];
    /** Status chip, mono uppercase (e.g. "OPTIMAL"). */
    status: string;
    /** One-line plain-language read of the trend. */
    note: string;
  };
}

/**
 * The activity fields the load bars and the header count read — the only fields
 * the live view needs, so `getDashboardActivities` rows fit unchanged (issue
 * #86); the DB's nullable averages never come into it.
 */
export interface CoachLoadActivityLike {
  /** ISO string from the Neon driver, or a real Date (demo fixtures) — every
   *  read below goes through `ensureDate`. See `ProgressionActivityInput`. */
  startDate: Date | string;
  /** Distance in meters. */
  distance: number;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Running activity types: "Run", "TrailRun", "VirtualRun", … */
function isRunActivity(activity: { type: string }): boolean {
  return /run/i.test(activity.type);
}

/** Kilometres run on the calendar day `daysAgo` days before `now`. */
function dailyKm(activities: CoachLoadActivityLike[], now: Date, daysAgo: number): number {
  const target = startOfDay(new Date(now.getTime() - daysAgo * DAY_MS));
  let km = 0;
  for (const a of activities) {
    if (startOfDay(ensureDate(a.startDate)) === target) km += a.distance / 1000;
  }
  return km;
}

// ── Training load (shared by demo + live) ───────────────────────────────────

/**
 * 14 daily bars of decayed acute load (each day = today + 6 prior days,
 * 0.8-decayed) so the shape reads like a rolling load, not raw km. The fraction
 * is the load's honest share of the window peak (issue #128) — a zero-load day
 * is 0, never a fabricated floor; the card decides how to *render* a zero.
 */
function buildLoadBars(activities: CoachLoadActivityLike[], now: Date): LoadBar[] {
  const raw: number[] = [];
  for (let d = 13; d >= 0; d--) {
    let load = 0;
    for (let k = 0; k < 7; k++) load += dailyKm(activities, now, d + k) * 0.8 ** k;
    raw.push(load);
  }
  const maxLoad = Math.max(...raw, 1);
  return raw.map((load, i) => ({
    id: `d${i}`,
    fraction: load / maxLoad,
    accent: i === raw.length - 1,
  }));
}

/** Acute (7-day) ÷ chronic (28-day) daily-km ratio, or null without a base. */
function acuteChronicRatio(activities: CoachLoadActivityLike[], now: Date): number | null {
  let acuteKm = 0;
  let chronicKm = 0;
  for (let d = 0; d < 28; d++) {
    const km = dailyKm(activities, now, d);
    if (d < 7) acuteKm += km;
    chronicKm += km;
  }
  const chronicDaily = chronicKm / 28;
  return chronicDaily > 0 ? acuteKm / 7 / chronicDaily : null;
}

/** Status chip values for the training-load card, mono uppercase. */
type LoadStatus = "AFKOBLING" | "OPTIMAL" | "SPÆNDING" | "RISIKO";

/**
 * Classify the acute:chronic ratio into the load-status chip (B8 fix — the chip
 * used to be hardcoded "OPTIMAL"). Null (no chronic base yet) reads as optimal.
 */
export function loadStatusFromRatio(ratio: number | null): LoadStatus {
  if (ratio === null) return "OPTIMAL";
  if (ratio < 0.8) return "AFKOBLING";
  if (ratio <= 1.3) return "OPTIMAL";
  if (ratio <= 1.5) return "SPÆNDING";
  return "RISIKO";
}

/** One-line plain-language read per load status — must never contradict the chip. */
const LOAD_NOTES: Record<LoadStatus, string> = {
  AFKOBLING: "Belastningen er faldende — der er plads til at bygge på igen.",
  OPTIMAL: "Belastningen stiger gradvist — ingen tegn på overtræning.",
  SPÆNDING: "Belastningen er højere end din base — hold ekstra øje med restitutionen.",
  RISIKO: "Akut belastning langt over din base — skru ned og prioritér restitution.",
};

/**
 * Trend chip + tone for the form card from a rise/fall ratio. Both builders
 * read the same bands off a different ratio: the demo view compares this week's
 * volume with last week's, the live view the acute:chronic load ratio. `1` (no
 * movement, or no ratio yet) reads STABIL.
 */
function formTrend(ratio: number): { trend: string; trendTone: "cobalt" | "red" } {
  if (ratio > 1.05) return { trend: "STIGENDE", trendTone: "cobalt" };
  if (ratio < 0.9) return { trend: "FALDENDE", trendTone: "red" };
  return { trend: "STABIL", trendTone: "cobalt" };
}

/**
 * The #273 same-day override for the form card (issue #273). A rolig Zone 1–2
 * tur leaves no trace in `hoursSinceHardEffort`, so the load-derived readiness
 * still reads "ready" hours after the runner was out — while the recommender
 * already calls today a hviledag. Only the ready band needs the override: the
 * easy and rest bands never promise intensity, and the readiness number and
 * band note stay exactly as load derived them.
 */
function sameDayNote(readiness: Readiness, hoursSinceRun: number | null): string | undefined {
  const ranToday = hoursSinceRun !== null && hoursSinceRun < EASY_MIN_RECOVERY_HOURS;
  return ranToday && readiness.band === "ready" ? SAME_DAY_RUN_NOTE : undefined;
}

export function buildCoachView(now: Date = new Date()): CoachView {
  const runs = demoActivities.filter(isRunActivity);

  // Form (readiness): the shared readinessFromRatio over the same progression
  // snapshot the Hjem readiness card reads (issue #127), so the two pages show
  // the identical number for the same fixtures.
  const snapshotRatio = computeSnapshot(
    demoActivities.map((a) => ({ ...a, hrZones: null })),
    now
  ).trainingLoad.ratio;
  // …capped by the recovery buffer (#259): load alone carries no intensity, so
  // without this the fixtures' hard parkrun this morning would still read "Klar
  // til hårdt pas". Same cap the Hjem card applies over the same fixtures.
  const readiness = readinessWithRecovery(
    readinessFromRatio(snapshotRatio),
    hoursSinceHardEffort(runs, now)
  );
  const { pct, note } = readiness;

  // Form trend: this week's volume vs. last week's.
  const thisWeek = getWeeklyVolume(demoActivities, 0);
  const lastWeek = getWeeklyVolume(demoActivities, 1);
  const trendRatio = lastWeek === 0 ? 1 : thisWeek / lastWeek;

  // Load status from the acute:chronic ratio (B8 fix — no longer hardcoded).
  const ratio = acuteChronicRatio(demoActivities, now);
  const status = loadStatusFromRatio(ratio);

  return {
    activityCount: demoActivities.length,
    focusQuote:
      "Progressiv 10 km torsdag — start 5:20, slut 4:25. Det bygger tempo-tolerance uden at koste restitution.",
    form: {
      pct,
      note,
      sameDayNote: sameDayNote(readiness, hoursSinceLastRun(runs, now)),
      ...formTrend(trendRatio),
    },
    load: {
      bars: buildLoadBars(demoActivities, now),
      status,
      note: LOAD_NOTES[status],
    },
  };
}

// ── Live view (authenticated) ───────────────────────────────────────────────

/** Danish card labels per recommended run type. */
const WORKOUT_LABELS = {
  easy: "Rolig Zone 2-tur",
  tempo: "Tempotur",
  long: "Lang tur",
} as const;

/** The week's headline recommendation as one focus-card sentence. */
function liveFocusQuote(workout: CoachDashboardData["workout"]): string {
  if (workout.type === "rest") {
    return workout.reason[0] ?? "Hviledag — restitution er en del af planen.";
  }
  return `${WORKOUT_LABELS[workout.type]} på ${workout.distanceKm} km — hold ${workout.paceRange.min}–${workout.paceRange.max} /km med puls under ${workout.heartRateCap}.`;
}

/**
 * The Coach view for an authenticated user: focus, form and load come from the
 * coach dashboard (recommender + progression engine) instead of the demo
 * fixtures.
 */
export function buildLiveCoachView(
  dashboard: CoachDashboardData,
  activities: CoachLoadActivityLike[],
  now: Date = new Date()
): CoachView {
  const { workout, loadGauge } = dashboard;
  const ratio = loadGauge.ratio;

  // Form (readiness) from the progression snapshot's acute:chronic ratio,
  // through the same readinessFromRatio the Hjem card uses (issue #127) —
  // readiness peaks when the load sits right on the chronic base (ratio ≈ 1) —
  // then capped by the recovery buffer (#259) so the card can't say "Klar til
  // hårdt pas" in the 48 h after a Zone 4–5 tur, which the load signal alone
  // (moving minutes, no intensity weighting) is blind to. The `?? null` keeps
  // partial dashboards — fixtures, older cached payloads — on the uncapped path
  // rather than throwing.
  const readiness = readinessWithRecovery(
    readinessFromRatio(ratio),
    dashboard.hoursSinceHardEffort ?? null
  );
  const { pct, note } = readiness;

  const status = loadStatusFromRatio(ratio);

  return {
    activityCount: activities.length,
    focusQuote: liveFocusQuote(workout),
    form: {
      pct,
      note,
      sameDayNote: sameDayNote(readiness, dashboard.hoursSinceLastRun ?? null),
      ...formTrend(ratio ?? 1),
    },
    load: {
      bars: buildLoadBars(activities, now),
      status,
      note: LOAD_NOTES[status],
    },
  };
}
