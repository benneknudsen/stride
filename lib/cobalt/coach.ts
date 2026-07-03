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

  const initialMessages: ChatMessage[] = [
    {
      id: "m1",
      role: "coach",
      text: "Godmorgen Benjamin! Din tempo-tolerance stiger — de sidste tre hårde pas har haft faldende puls ved samme pace. Jeg anbefaler 10 km progressiv torsdag: start 5:20, slut 4:25.",
    },
    { id: "m2", role: "user", text: "Hvordan så min lange tur ud i søndags?" },
    {
      id: "m3",
      role: "coach",
      text: `Stærk tur: ${longRunKm} km i snit ${longRunPace} /km med stabil puls på ${longRunHr}. Du løb negativ split — anden halvdel 12 sekunder hurtigere. Det er præcis den udvikling vi vil se 10 uger før race.`,
    },
  ];

  const prompts = ["Analysér min uge", "Foreslå næste pas", "Er jeg klar til CPH Marathon?"];

  const replies = [
    "Godt spørgsmål. Ud fra dine seneste 28 ture ligger du 8 % foran planen, og restitutionen er på 86 % — så jeg vil holde fast i torsdagens progressive pas og ellers prioritere rolige kilometer resten af ugen.",
    "Din uge ser balanceret ud: 41 % i rolig snak-fart, resten fordelt på moderat og hårdt. Vil du have, at jeg justerer søndagens lange tur, hvis vejret bliver varmt?",
    "Baseret på din nuværende form estimerer jeg en marathontid på 3:41–3:48. Målet på 3:45 er realistisk, hvis volumen holder de næste 6 uger.",
  ];

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
