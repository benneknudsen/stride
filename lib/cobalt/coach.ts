// Cobalt Glass — Coach view-model.
// Pure derivation (no React) from activity data, mirroring lib/cobalt/hjem.ts
// and lib/cobalt/aktiviteter.ts, so the same presentational chat + dashboards
// render demo and live data. Day-granular bucketing keeps the server render
// and client hydration in agreement.
//
// Two builders share the CoachView shape:
//   - buildCoachView()      — the demo fallback: scripted transcript + fixture
//                             numbers for unauthenticated visitors.
//   - buildLiveCoachView()  — the authenticated path: focus, form and load are
//                             derived from the coach dashboard (recommender +
//                             progression engine) instead of scripted copy.
//
// The chat opens with welcome messages; live answers stream from /api/ai/chat
// (the ChatPanel owns that flow).

import type { CoachDashboardData } from "@/lib/coach/dashboard";
import { DEFAULT_RACE_DATE } from "@/lib/coach/engine";
import { readinessFromRatio } from "@/lib/cobalt/readiness";
import { demoActivities } from "@/lib/demo/data";
import { formatPace, getWeeklyVolume } from "@/lib/metrics";
import { computeSnapshot } from "@/lib/training/progression-core";

const DAY_MS = 86_400_000;

export type ChatRole = "coach" | "user";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
}

export interface LoadBar {
  /** Day index 0 (13 days ago) → 13 (today). */
  id: string;
  /** Relative bar height 0–1. */
  fraction: number;
  /** The final bar (today) reads red; the rest are cobalt. */
  accent: boolean;
}

export interface CoachView {
  /** Header count — "AI COACH · BASERET PÅ N TURE". */
  activityCount: number;
  /** Opening transcript shown when the page loads. */
  initialMessages: ChatMessage[];
  /** Quick-prompt chips under the chat. */
  prompts: string[];
  /** "Ugens fokus" — the week's headline recommendation (serif quote). */
  focusQuote: string;
  form: {
    /** Readiness percentage (e.g. 86). */
    pct: number;
    /** Plain-language note, e.g. "Klar til hårdt pas". */
    note: string;
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
  startDate: Date;
  /** Distance in meters. */
  distance: number;
}

/** What the scripted demo transcript reads on top of that — fixtures always carry it. */
export interface CoachActivityLike extends CoachLoadActivityLike {
  averageSpeed: number;
  averageHeartrate: number;
}

/** The three quick-prompt chips under the chat — same in demo and live. */
const COACH_PROMPTS = ["Analysér min uge", "Foreslå næste pas", "Er jeg klar til halvmarathon?"];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Kilometres run on the calendar day `daysAgo` days before `now`. */
function dailyKm(activities: CoachLoadActivityLike[], now: Date, daysAgo: number): number {
  const target = startOfDay(new Date(now.getTime() - daysAgo * DAY_MS));
  let km = 0;
  for (const a of activities) {
    if (startOfDay(a.startDate) === target) km += a.distance / 1000;
  }
  return km;
}

/** Average heart rate across runs in the day-window (from, to] days ago, or null. */
function windowAvgHr(
  activities: CoachActivityLike[],
  now: Date,
  fromDaysAgo: number,
  toDaysAgo: number
): number | null {
  const start = now.getTime() - toDaysAgo * DAY_MS;
  const end = now.getTime() - fromDaysAgo * DAY_MS;
  const samples = activities
    .filter((a) => a.startDate.getTime() > start && a.startDate.getTime() <= end)
    .map((a) => a.averageHeartrate)
    .filter((hr) => hr > 0);
  if (samples.length === 0) return null;
  return Math.round(samples.reduce((sum, hr) => sum + hr, 0) / samples.length);
}

/** Whole weeks until the goal race (never negative). Demo default per #99. */
function weeksToRace(now: Date, raceDate: Date = DEFAULT_RACE_DATE): number {
  return Math.max(0, Math.round((raceDate.getTime() - now.getTime()) / (7 * DAY_MS)));
}

/** Longest run within the last `days`, or null when the window is empty. */
function longestInWindow(activities: CoachActivityLike[], now: Date, days: number) {
  const from = now.getTime() - days * DAY_MS;
  let best: CoachActivityLike | null = null;
  for (const a of activities) {
    if (a.startDate.getTime() < from) continue;
    if (!best || a.distance > best.distance) best = a;
  }
  return best;
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
export type LoadStatus = "AFKOBLING" | "OPTIMAL" | "SPÆNDING" | "RISIKO";

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

/** "Godmorgen Nadia!" with a name, plain "Godmorgen!" without one. */
function greeting(userName?: string): string {
  return userName ? `Godmorgen ${userName}!` : "Godmorgen!";
}

export function buildCoachView(now: Date = new Date(), userName?: string): CoachView {
  const latest = demoActivities[0];

  // Long run → message 3, derived from the real fixture so the numbers are live.
  const longRun = longestInWindow(demoActivities, now, 7) ?? latest;
  const longRunKm = (longRun.distance / 1000).toFixed(1).replace(".", ",");
  const longRunPace = formatPace(longRun.averageSpeed);
  const longRunHr = longRun.averageHeartrate;

  // Every numeric claim in the transcript is derived from the fixtures — a
  // scripted chat must never assert data the surrounding dashboards contradict.
  const avgHrLast7 = windowAvgHr(demoActivities, now, 0, 7);
  const avgHrPrev7 = windowAvgHr(demoActivities, now, 7, 14);
  const raceWeeks = weeksToRace(now);

  const hrTrendLine =
    avgHrLast7 !== null && avgHrPrev7 !== null
      ? avgHrLast7 < avgHrPrev7
        ? `Din aerobe form udvikler sig — gennemsnitspulsen er faldet fra ${avgHrPrev7} til ${avgHrLast7} den seneste uge.`
        : avgHrLast7 > avgHrPrev7
          ? `Din puls ligger lidt højere end ugen før (${avgHrPrev7} → ${avgHrLast7}), så mærk efter undervejs.`
          : `Din puls ligger stabilt på ${avgHrLast7} — god konsistens.`
      : "Din træning ser konsistent ud.";

  const initialMessages: ChatMessage[] = [
    {
      id: "m1",
      role: "coach",
      text: `${greeting(userName)} ${hrTrendLine} Jeg anbefaler 10 km progressiv torsdag: start 5:20, slut 4:25.`,
    },
    { id: "m2", role: "user", text: "Hvordan så min lange tur ud i søndags?" },
    {
      id: "m3",
      role: "coach",
      text: `Stærk tur: ${longRunKm} km i snit ${longRunPace} /km med stabil puls på ${longRunHr}. Det er præcis den udvikling vi vil se ${raceWeeks} uger før race.`,
    },
  ];

  const prompts = COACH_PROMPTS;

  // Form (readiness): the shared readinessFromRatio over the same progression
  // snapshot the Hjem readiness card reads (issue #127), so the two pages show
  // the identical number for the same fixtures.
  const snapshotRatio = computeSnapshot(
    demoActivities.map((a) => ({ ...a, hrZones: null })),
    now
  ).trainingLoad.ratio;
  const { pct, note } = readinessFromRatio(snapshotRatio);

  // Form trend: this week's volume vs. last week's.
  const thisWeek = getWeeklyVolume(demoActivities, 0);
  const lastWeek = getWeeklyVolume(demoActivities, 1);
  const trendRatio = lastWeek === 0 ? 1 : thisWeek / lastWeek;

  const [trend, trendTone] =
    trendRatio > 1.05
      ? (["STIGENDE", "cobalt"] as const)
      : trendRatio < 0.9
        ? (["FALDENDE", "red"] as const)
        : (["STABIL", "cobalt"] as const);

  // Load status from the acute:chronic ratio (B8 fix — no longer hardcoded).
  const ratio = acuteChronicRatio(demoActivities, now);
  const status = loadStatusFromRatio(ratio);

  return {
    activityCount: demoActivities.length,
    initialMessages,
    prompts,
    focusQuote:
      "Progressiv 10 km torsdag — start 5:20, slut 4:25. Det bygger tempo-tolerance uden at koste restitution.",
    form: { pct, note, trend, trendTone },
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
 * coach dashboard (recommender + progression engine) instead of scripted demo
 * copy. The welcome transcript is generated from the same numbers, so the chat
 * never asserts data the surrounding cards contradict.
 */
export function buildLiveCoachView(
  dashboard: CoachDashboardData,
  activities: CoachLoadActivityLike[],
  now: Date = new Date(),
  userName?: string
): CoachView {
  const { workout, loadGauge } = dashboard;
  const ratio = loadGauge.ratio;

  // Form (readiness) from the progression snapshot's acute:chronic ratio,
  // through the same readinessFromRatio the Hjem card uses (issue #127) —
  // readiness peaks when the load sits right on the chronic base (ratio ≈ 1).
  const { pct, note } = readinessFromRatio(ratio);

  const [trend, trendTone] =
    ratio !== null && ratio > 1.05
      ? (["STIGENDE", "cobalt"] as const)
      : ratio !== null && ratio < 0.9
        ? (["FALDENDE", "red"] as const)
        : (["STABIL", "cobalt"] as const);

  const status = loadStatusFromRatio(ratio);
  const focusQuote = liveFocusQuote(workout);

  const loadAnswer =
    ratio === null
      ? `Du har endnu ikke fire ugers historik, så belastningsbilledet er foreløbigt. ${LOAD_NOTES[status]}`
      : `Din akut/kronisk-ratio er ${ratio.toFixed(2)} — status ${status}. ${LOAD_NOTES[status]}`;

  const initialMessages: ChatMessage[] = [
    {
      id: "m1",
      role: "coach",
      text: `${greeting(userName)} Din readiness er ${pct}% — ${note.toLowerCase()}. Ugens anbefaling: ${focusQuote}`,
    },
    { id: "m2", role: "user", text: "Hvordan ser min træningsbelastning ud?" },
    { id: "m3", role: "coach", text: loadAnswer },
  ];

  return {
    activityCount: activities.length,
    initialMessages,
    prompts: COACH_PROMPTS,
    focusQuote,
    form: { pct, note, trend, trendTone },
    load: {
      bars: buildLoadBars(activities, now),
      status,
      note: LOAD_NOTES[status],
    },
  };
}
