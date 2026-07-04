// Cobalt Glass — Coach view-model.
// Pure derivation (no React) from the demo fixture activities, mirroring
// lib/cobalt/hjem.ts and lib/cobalt/aktiviteter.ts, so the same presentational
// chat + dashboards render demo and live data. Day-granular bucketing keeps the
// server render and client hydration in agreement.
//
// The chat itself is a scripted demo (initial transcript + cycling canned
// replies), matching the design reference — there is no chat endpoint yet.
// A few numbers (activity count, the long run, form %, the 14-day load bars)
// are derived from the fixtures so the surrounding UI reads as live data.

import { RACE_DATE } from "@/lib/coach/engine";
import { demoActivities } from "@/lib/demo/data";
import { formatPace, getWeeklyVolume } from "@/lib/metrics";

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
  /** Coach replies, cycled one per user message. */
  replies: string[];
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

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Kilometres run on the calendar day `daysAgo` days before `now`. */
function dailyKm(now: Date, daysAgo: number): number {
  const target = startOfDay(new Date(now.getTime() - daysAgo * DAY_MS));
  let km = 0;
  for (const a of demoActivities) {
    if (startOfDay(a.startDate) === target) km += a.distance / 1000;
  }
  return km;
}

/** Average heart rate across runs in the day-window (from, to] days ago, or null. */
function windowAvgHr(now: Date, fromDaysAgo: number, toDaysAgo: number): number | null {
  const start = now.getTime() - toDaysAgo * DAY_MS;
  const end = now.getTime() - fromDaysAgo * DAY_MS;
  const samples = demoActivities
    .filter((a) => a.startDate.getTime() > start && a.startDate.getTime() <= end)
    .map((a) => a.averageHeartrate)
    .filter((hr) => hr > 0);
  if (samples.length === 0) return null;
  return Math.round(samples.reduce((sum, hr) => sum + hr, 0) / samples.length);
}

/** Whole weeks until the goal race (never negative). */
function weeksToRace(now: Date): number {
  return Math.max(0, Math.round((RACE_DATE.getTime() - now.getTime()) / (7 * DAY_MS)));
}

/** Half-marathon estimate from a run's average speed — "t:mm–t:mm" (± 2 min). */
function estimateHalfMarathonRange(averageSpeed: number): string | null {
  if (!averageSpeed || averageSpeed <= 0) return null;
  const HALF_MARATHON_KM = 21.0975;
  // Race pace runs a touch faster than training pace — a conservative 95%.
  const estimateSec = (1000 / averageSpeed) * 0.95 * HALF_MARATHON_KM;
  const fmt = (totalSec: number) => {
    const totalMin = Math.round(totalSec / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}:${m.toString().padStart(2, "0")}`;
  };
  return `${fmt(estimateSec - 120)}–${fmt(estimateSec + 120)}`;
}

/** Longest run within the last `days`, or null when the window is empty. */
function longestInWindow(now: Date, days: number) {
  const from = now.getTime() - days * DAY_MS;
  let best: (typeof demoActivities)[number] | null = null;
  for (const a of demoActivities) {
    if (a.startDate.getTime() < from) continue;
    if (!best || a.distance > best.distance) best = a;
  }
  return best;
}

export function buildCoachView(now: Date = new Date()): CoachView {
  const latest = demoActivities[0];

  // Long run → message 3, derived from the real fixture so the numbers are live.
  const longRun = longestInWindow(now, 7) ?? latest;
  const longRunKm = (longRun.distance / 1000).toFixed(1).replace(".", ",");
  const longRunPace = formatPace(longRun.averageSpeed);
  const longRunHr = longRun.averageHeartrate;

  // Every numeric claim in the transcript is derived from the fixtures — a
  // scripted chat must never assert data the surrounding dashboards contradict.
  const avgHrLast7 = windowAvgHr(now, 0, 7);
  const avgHrPrev7 = windowAvgHr(now, 7, 14);
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
      text: `Godmorgen Benjamin! ${hrTrendLine} Jeg anbefaler 10 km progressiv torsdag: start 5:20, slut 4:25.`,
    },
    { id: "m2", role: "user", text: "Hvordan så min lange tur ud i søndags?" },
    {
      id: "m3",
      role: "coach",
      text: `Stærk tur: ${longRunKm} km i snit ${longRunPace} /km med stabil puls på ${longRunHr}. Det er præcis den udvikling vi vil se ${raceWeeks} uger før race.`,
    },
  ];

  const prompts = ["Analysér min uge", "Foreslå næste pas", "Er jeg klar til halvmarathon?"];

  // Form (readiness): same heuristic as the Hjem "Restitution" widget so the
  // two pages agree — lower recent HR reads as fresher legs.
  const pct = Math.min(95, Math.max(60, Math.round(150 - latest.averageHeartrate * 0.45)));
  const note =
    pct >= 80
      ? "Klar til hårdt pas"
      : pct >= 68
        ? "Let træning anbefalet"
        : "Prioritér hvile i dag";

  // Form trend: this week's volume vs. last week's.
  const thisWeek = getWeeklyVolume(demoActivities, 0);
  const lastWeek = getWeeklyVolume(demoActivities, 1);
  const trendRatio = lastWeek === 0 ? 1 : thisWeek / lastWeek;

  const volDeltaPct = Math.round((trendRatio - 1) * 100);
  const volLine =
    volDeltaPct >= 0 ? `${volDeltaPct} % over sidste uge` : `${-volDeltaPct} % under sidste uge`;
  const halfEstimate = estimateHalfMarathonRange(longRun.averageSpeed);

  const replies = [
    `Godt spørgsmål. Ud fra dine seneste ${demoActivities.length} ture ligger ugens volumen ${volLine}, og restitutionen er på ${pct} % — så jeg vil holde fast i torsdagens progressive pas og ellers prioritere rolige kilometer resten af ugen.`,
    "Din uge ser balanceret ud med hovedvægten på rolig snak-fart og resten fordelt på moderat og hårdt. Vil du have, at jeg justerer søndagens lange tur, hvis vejret bliver varmt?",
    halfEstimate
      ? `Baseret på din nuværende form estimerer jeg en halvmarathontid på ${halfEstimate}. Silkeborg Halvmarathon om ${raceWeeks} uger er realistisk, hvis volumen holder.`
      : `Silkeborg Halvmarathon er om ${raceWeeks} uger — hold volumen stabil, så tager vi en formvurdering, når der er flere ture i bogen.`,
  ];
  const [trend, trendTone] =
    trendRatio > 1.05
      ? (["STIGENDE", "cobalt"] as const)
      : trendRatio < 0.9
        ? (["FALDENDE", "red"] as const)
        : (["STABIL", "cobalt"] as const);

  // 14-day training load: a decayed acute load (today + 6 prior days) so every
  // day carries a value and the shape reads like a rolling load, not raw km.
  const raw: number[] = [];
  for (let d = 13; d >= 0; d--) {
    let load = 0;
    for (let k = 0; k < 7; k++) load += dailyKm(now, d + k) * 0.8 ** k;
    raw.push(load);
  }
  const maxLoad = Math.max(...raw, 1);
  const bars: LoadBar[] = raw.map((load, i) => ({
    id: `d${i}`,
    fraction: 0.18 + (load / maxLoad) * 0.82,
    accent: i === raw.length - 1,
  }));

  return {
    activityCount: demoActivities.length,
    initialMessages,
    prompts,
    replies,
    focusQuote:
      "Progressiv 10 km torsdag — start 5:20, slut 4:25. Det bygger tempo-tolerance uden at koste restitution.",
    form: { pct, note, trend, trendTone },
    load: {
      bars,
      status: "OPTIMAL",
      note: "Belastningen stiger gradvist — ingen tegn på overtræning.",
    },
  };
}
