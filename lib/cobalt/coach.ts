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
import { DEFAULT_RACE_DATE, EASY_MIN_RECOVERY_HOURS } from "@/lib/coach/engine";
import { TEMPO_HR_CAP_BPM } from "@/lib/coach/recommender";
import {
  readinessFromRatio,
  readinessWithRecovery,
  SAME_DAY_RUN_NOTE,
} from "@/lib/cobalt/readiness";
import { ensureDate } from "@/lib/db/calendar-date";
import { type DemoActivity, demoActivities } from "@/lib/demo/data";
import { formatPace, getWeeklyVolume } from "@/lib/metrics";
import { hoursSinceHardEffort } from "@/lib/training/effort";
import { computeSnapshot } from "@/lib/training/progression-core";
import type { ChatBlock } from "@/types/chat";

const DAY_MS = 86_400_000;

export type ChatRole = "coach" | "user";

/**
 * A persisted chat turn as `getChatHistory` returns it — the signed-in user's
 * stored conversation, replayed into the panel on load (issue #202). Roles are
 * the model's ("assistant"/"user"); the view-model maps "assistant" → "coach".
 */
interface ChatHistoryEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Rehydrated generative-UI blocks for assistant turns (issue #228). */
  blocks?: ChatBlock[];
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /**
   * Generative-UI blocks streamed alongside the text of a coach turn (issue
   * #221): clickable activity cards and workout cards, built server-side from
   * tool output. Absent on user turns and the synthetic opener; replayed
   * history carries persisted activity references rehydrated on read (issue
   * #228), while workout blocks are intentionally omitted because they go stale.
   */
  blocks?: ChatBlock[];
  /**
   * The scripted opening bubble is `synthetic: true`: it is shown so the panel
   * never starts empty, but the ChatPanel strips synthetic turns before POSTing
   * to /api/ai/chat so the coach's own greeting never becomes model context and
   * no fabricated user turn is ever sent as if the visitor wrote it (issue #201).
   */
  synthetic?: boolean;
  /**
   * Idempotency key for user turns (issue #205). The client generates a fresh
   * id per message; retry sends the same id so the route can deduplicate. For
   * replayed history it is the persisted row id; synthetic turns omit it.
   */
  clientId?: string;
}

interface LoadBar {
  /** Day index 0 (13 days ago) → 13 (today). */
  id: string;
  /** Relative bar height 0–1. */
  fraction: number;
  /** The final bar (today) reads red; the rest are cobalt. */
  accent: boolean;
}

/**
 * A scripted visitor reply (issue #235): the answer text plus optional
 * generative-UI blocks (clickable activity cards / workout cards) built from the
 * same fixtures. The blocks render through the shared {@link ChatBlock} path, so
 * MessageBubble can't tell a demo card from a live one — the visitor demo shows
 * real interactive UI, not just prose.
 */
interface DemoReply {
  text: string;
  blocks?: ChatBlock[];
}

export interface CoachView {
  /** Header count — "AI COACH · BASERET PÅ N TURE". */
  activityCount: number;
  /**
   * Opening transcript shown when the page loads: the signed-in user's persisted
   * history (issue #202), followed by the synthetic coach opener.
   */
  initialMessages: ChatMessage[];
  /** Quick-prompt chips under the chat. */
  prompts: string[];
  /**
   * Scripted coach answers for signed-out visitors, keyed by chip label (issue
   * #203). The public demo shows the full chat UI, but /api/ai/chat is
   * session-gated — so a visitor's chip tap renders one of these precomputed
   * replies (derived from the same fixtures the dashboards read) instead of
   * firing a request that can only 401. Only `buildCoachView` (the demo
   * fallback) populates it; the live view leaves it undefined.
   */
  demoReplies?: Record<string, DemoReply>;
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
  /** ISO string from the Neon driver, or a real Date (demo fixtures) — every
   *  read below goes through `ensureDate`. See `ProgressionActivityInput`. */
  startDate: Date | string;
  /** Distance in meters. */
  distance: number;
}

/** What the scripted demo transcript reads on top of that — fixtures always carry it. */
interface CoachActivityLike extends CoachLoadActivityLike {
  averageSpeed: number;
  averageHeartrate: number;
}

/** The three quick-prompt chips under the chat — same in demo and live. */
const COACH_PROMPTS = ["Analysér min uge", "Foreslå næste pas", "Er jeg klar til halvmarathon?"];

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
    .filter((a) => {
      const t = ensureDate(a.startDate).getTime();
      return t > start && t <= end;
    })
    .map((a) => a.averageHeartrate)
    .filter((hr) => hr > 0);
  if (samples.length === 0) return null;
  return Math.round(samples.reduce((sum, hr) => sum + hr, 0) / samples.length);
}

/** Whole weeks until the goal race (never negative). Demo default per #99. */
function weeksToRace(now: Date, raceDate: Date = DEFAULT_RACE_DATE): number {
  return Math.max(0, Math.round((raceDate.getTime() - now.getTime()) / (7 * DAY_MS)));
}

/** Longest run within the last `days`, or null when the window is empty.
 *  Generic so it preserves the caller's row type — passed `demoActivities` it
 *  returns a full {@link DemoActivity} whose `id`/`type`/`movingTime` the chat
 *  ActivityCard block needs (issue #235). */
function longestInWindow<T extends CoachLoadActivityLike>(
  activities: T[],
  now: Date,
  days: number
): T | null {
  const from = now.getTime() - days * DAY_MS;
  let best: T | null = null;
  for (const a of activities) {
    if (ensureDate(a.startDate).getTime() < from) continue;
    if (!best || a.distance > best.distance) best = a;
  }
  return best;
}

/**
 * A demo fixture as a clickable chat ActivityCard block (issue #235). The
 * `ChatActivity` shape is exactly what the live `/api/ai/chat` route emits from
 * `getRecentActivities`, so the same MessageBubble/ActivityCard renders it and
 * the card links to the activity's detail page — every number comes off the
 * fixture, never hardcoded.
 */
function activityBlock(activity: DemoActivity): ChatBlock {
  return {
    kind: "activity",
    activity: {
      id: activity.id,
      type: activity.type,
      startDate: activity.startDate.toISOString(),
      distance: activity.distance,
      movingTime: activity.movingTime,
      averageHeartrate: activity.averageHeartrate,
    },
  };
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

/** "Godmorgen Nadia!" with a name, plain "Godmorgen!" without one. */
function greeting(userName?: string): string {
  return userName ? `Godmorgen ${userName}!` : "Godmorgen!";
}

/**
 * The user's persisted conversation as panel bubbles (issue #202): mapped to the
 * panel's roles ("assistant" → "coach") and left non-synthetic, so they render
 * as real turns and — unlike the scripted opener — are kept as the route's
 * fallback context when the DB history read fails (app/api/ai/chat/route.ts).
 */
function historyMessages(history: ChatHistoryEntry[]): ChatMessage[] {
  return history.map((entry, i) => ({
    id: `h${i}`,
    clientId: entry.id,
    role: entry.role === "assistant" ? "coach" : "user",
    text: entry.content,
    blocks: entry.blocks,
  }));
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

  // A single coach opening bubble (issue #201): greeting, the aerobic-trend
  // read, the long-run summary (was m3) and the week's recommendation, folded
  // into one turn so the panel never opens with a fabricated user question.
  const initialMessages: ChatMessage[] = [
    {
      id: "m1",
      role: "coach",
      synthetic: true,
      text: `${greeting(userName)} ${hrTrendLine} Din lange tur i søndags var stærk: ${longRunKm} km i snit ${longRunPace} /km med stabil puls på ${longRunHr} — præcis den udvikling vi vil se ${raceWeeks} uger før race. Jeg anbefaler 10 km progressiv torsdag: start 5:20, slut 4:25.`,
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
  // …capped by the recovery buffer (#259): load alone carries no intensity, so
  // without this the fixtures' hard parkrun this morning would still read "Klar
  // til hårdt pas". Same cap the Hjem card applies over the same fixtures.
  const { pct, note } = readinessWithRecovery(
    readinessFromRatio(snapshotRatio),
    hoursSinceHardEffort(demoActivities.filter(isRunActivity), now)
  );

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

  // Scripted answers for a signed-out visitor's chip taps (issue #203) — each
  // derived from the same fixtures the opener and dashboards read, so a demo
  // reply never contradicts what's on screen. Keyed by the exact chip labels.
  const demoReplies: Record<string, DemoReply> = {
    // "Analysér min uge" — the week read, plus the actual long run as a clickable
    // card so the card's numbers reinforce the text instead of just repeating it.
    [COACH_PROMPTS[0]]: {
      text: `${hrTrendLine} Din længste tur den seneste uge var ${longRunKm} km i snit ${longRunPace} /km med puls ${longRunHr}. Samlet ser ugen konsistent ud — god balance mellem rolige og hårde pas.`,
      blocks: [activityBlock(longRun)],
    },
    // "Foreslå næste pas" — the same 10 km progressive session the opener and the
    // focus card name, rendered as the workout card the live route would emit.
    [COACH_PROMPTS[1]]: {
      text: "Jeg anbefaler 10 km progressiv torsdag: start 5:20, slut 4:25. Det bygger tempo-tolerance uden at koste restitution.",
      blocks: [
        {
          kind: "workout",
          workout: {
            type: "tempo",
            distanceKm: 10,
            paceRange: { min: "4:25", max: "5:20" },
            heartRateCap: TEMPO_HR_CAP_BPM,
            shoe: "adios-pro-4",
            reason: [
              "Progressiv 10 km — start 5:20, slut 4:25.",
              "Bygger tempo-tolerance uden at koste restitutionen.",
            ],
          },
        },
      ],
    },
    [COACH_PROMPTS[2]]: {
      text: `Din readiness ligger på ${pct}% — ${note.toLowerCase()}. Der er ${raceWeeks} uger til dit race, og formen udvikler sig planmæssigt. Hold fokus på de lange ture, så er du klar.`,
    },
  };

  return {
    activityCount: demoActivities.length,
    initialMessages,
    prompts,
    demoReplies,
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
  userName?: string,
  history: ChatHistoryEntry[] = []
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
  const { pct, note, band } = readinessWithRecovery(
    readinessFromRatio(ratio),
    dashboard.hoursSinceHardEffort ?? null
  );

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

  // The opener's readiness line (#273): inside the 24 h recovery window after
  // ANY run, the ready band's "Klar til hårdt pas" is replaced with a line that
  // names the run — a rolig Zone 1–2 tur never trips the #259 hard-effort cap,
  // so without this the opener promised a hard pas hours after the runner was
  // actually out, contradicting both cards' hviledag. The readiness percentage
  // and the cap itself are unchanged.
  const ranRecently =
    dashboard.hoursSinceLastRun != null && dashboard.hoursSinceLastRun < EASY_MIN_RECOVERY_HOURS;
  const readinessLine =
    ranRecently && band === "ready"
      ? SAME_DAY_RUN_NOTE
      : `Din readiness er ${pct}% — ${note.toLowerCase()}.`;

  // The persisted conversation is replayed first (issue #202) so a returning
  // user sees and can continue their history. A fresh coach opening bubble is
  // only shown when there is no history (issue #205) — otherwise every page load
  // would greet the user with "Godmorgen!" on top of an existing thread.
  const opener: ChatMessage = {
    id: "m1",
    role: "coach",
    synthetic: true,
    text: `${greeting(userName)} ${readinessLine} ${loadAnswer} Ugens anbefaling: ${focusQuote}`,
  };
  const initialMessages: ChatMessage[] = history.length > 0 ? historyMessages(history) : [opener];

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
