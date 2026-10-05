/**
 * Analysis input shaping and the deterministic block builder.
 *
 * Raw activities are reduced to a compact, rounded summary (`AnalysisInput`),
 * and `heuristicBlocks` turns that summary into the same typed blocks a model
 * used to author. Every number a block carries is arithmetic over the athlete's
 * own runs, so the analysis is reproducible, needs no provider and costs
 * nothing to serve.
 */

import { getLocalDate } from "@/lib/coach/engine";
import { DA_WEEKDAYS, formatDanish } from "@/lib/cobalt/format";
import { ensureDate } from "@/lib/db/calendar-date";
import { formatDuration, formatPace } from "@/lib/metrics";
import { computeSnapshot, type LoadRisk } from "@/lib/training/progression";
import type { AnalysisScope } from "@/types/domain";
import type { AnalysisBlock, AnalysisBlockOf } from "./tools";

// ---------------------------------------------------------------------------
// Input shaping
// ---------------------------------------------------------------------------

/**
 * The minimal per-activity fields the analysis reasons over.
 *
 * Deliberately source-agnostic (issue #184). The `activities` table *does*
 * carry a `source` column, but the Strava mapper (`lib/strava/mappers.ts`)
 * normalises into a fixed set of physical columns and unit conventions
 * (distance in metres, times in seconds, speed in m/s, HR in bpm, single-leg
 * cadence). The reads that feed the analysis (`getActivities`,
 * `getDashboardActivities`) filter by `userId` only, never by `source`, so the
 * coach sees every synced run regardless of origin. That is why nothing here
 * needs a `source` field. Add provider-specific inputs here only if a metric
 * ever becomes source-dependent.
 */
export interface AnalysisActivity {
  startDate: Date;
  /** Distance in meters. */
  distance: number;
  /** Moving time in seconds. */
  movingTime: number;
  /** Average speed in meters/second (Strava convention), if recorded. */
  averageSpeed?: number | null;
  /** Average heart rate in bpm, if recorded. */
  averageHeartrate?: number | null;
  /** Total elevation gain in meters. */
  totalElevationGain?: number | null;
}

/**
 * Progression metrics folded into the analysis input (#33) — a rounded subset
 * of `ProgressionSnapshot` (lib/training/progression.ts), kept small and
 * deterministic so it hashes stably.
 */
interface AnalysisProgression {
  /** True when at least 4 weeks of history exist. Metrics below are null without it. */
  hasFullWindow: boolean;
  /** Acute:chronic training-load ratio, rounded to 2 decimals. */
  loadRatio: number | null;
  /** Risk band for the load ratio. */
  loadRisk: LoadRisk | null;
  /** Total running distance over the 4-week window, in km. */
  volumeKm: number | null;
  /** Whether the load ratio says the athlete can safely add volume. */
  readyToIncrease: boolean | null;
}

/** A compact, rounded summary of an athlete's training — the analysis input. */
export interface AnalysisInput {
  scope: AnalysisScope;
  totalRuns: number;
  totalDistanceKm: number;
  longestRunKm: number;
  totalElevationM: number;
  /** Volume per week (km), index 0 = this week, 1 = last week, … */
  weeklyVolumeKm: number[];
  /** Average pace (seconds per km) over the last 7 days, null if none. */
  avgPaceLast7: number | null;
  /** Average pace (seconds per km) over the prior 7 days, null if none. */
  avgPacePrev7: number | null;
  /** Average heart rate (bpm) over the last 7 days, null if none. */
  avgHrLast7: number | null;
  /** Average heart rate (bpm) over the prior 7 days, null if none. */
  avgHrPrev7: number | null;
  /** Training-load progression over the trailing 4 weeks. */
  progression: AnalysisProgression;
  /**
   * The engine's plan facts for the per-run review (#298), supplied by the
   * server. Absent on every context-free path, where no review is emitted.
   */
  planContext?: RunReviewPlanContext;
}

/** One of the week's three plan suggestions, flattened for the wire (#298). */
export interface RunReviewSuggestion {
  type: "easy" | "tempo" | "long";
  /** Danish label ("Let pas" / "Kvalitetspas" / "Langtur"). */
  label: string;
  /** Plain-language description ("Rolig restitution" / "Tempo · hårdt"). */
  description: string;
  distanceKm: number;
  /** Target pace range, fast → slow, formatted "m:ss". */
  paceRange: { min: string; max: string };
}

/** The runner's most recent run, pre-computed server-side for the review (#298). */
export interface RunReviewLastRun {
  startDate: Date | string;
  distanceKm: number;
  paceSecPerKm: number;
  averageHeartrate: number | null;
  /** Moving time in seconds — the review names the duration ("45 min"). */
  movingTimeSec: number;
}

/** The recommender's own decision for the next run, flattened for the wire (#298). */
export interface RunReviewRecommendation {
  type: "rest" | "easy" | "tempo" | "long";
  distanceKm: number;
  /** The first reason line from `recommendWorkout`, in its own Danish words. */
  reason: string;
}

/**
 * The engine's plan facts the server derives and sends for the per-run review
 * (#298): phase, race, readiness band, recovery window, the three suggestions
 * and the recommender's decision. Plain JSON — it crosses to the client and
 * comes back on the wire, where the analyze route validates it.
 */
export interface RunReviewPlanContext {
  /** The engine's phase key, e.g. "burn". */
  phase: string;
  /** Danish phase label, e.g. "Burn". */
  phaseLabel: string;
  /** Race label from the user's own race plan, or the engine's demo name. */
  raceLabel: string | null;
  /** Whole days from `now` to the race; null when no race is set. */
  daysToRace: number | null;
  /** The readiness band the Hjem gauge and the recommender show for the ratio. */
  readiness: { pct: number; band: "ready" | "easy" | "rest"; note: string };
  /** Hours of recovery the engine requires before the recommended run. */
  recoveryHours: number;
  /** The three phase-aware suggestions from `getPlanSuggestions`. */
  suggestions: RunReviewSuggestion[];
  /** The runner's most recent run, or null when there is none. */
  lastRun: RunReviewLastRun | null;
  /** The recommender's decision for the next run — the review echoes it. */
  recommended: RunReviewRecommendation;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Average pace (seconds/km) across a set of runs, or null if none have distance. */
function windowPace(runs: AnalysisActivity[]): number | null {
  const distance = runs.reduce((sum, r) => sum + r.distance, 0);
  const time = runs.reduce((sum, r) => sum + r.movingTime, 0);
  if (distance <= 0 || time <= 0) return null;
  return round((time / distance) * 1000, 0);
}

/** Average heart rate across runs that recorded it, or null. */
function windowHr(runs: AnalysisActivity[]): number | null {
  const samples = runs
    .map((r) => r.averageHeartrate)
    .filter((hr): hr is number => typeof hr === "number" && hr > 0);
  if (samples.length === 0) return null;
  const sum = samples.reduce((acc, hr) => acc + hr, 0);
  return Math.round(sum / samples.length);
}

/**
 * Reduce raw activities to a deterministic summary. `now` is injected so the
 * hash is reproducible in tests; production passes the request time. The
 * optional `planContext` (#298) rides along untouched — without it the summary
 * is exactly what it always was.
 */
export function buildAnalysisInput(
  activities: AnalysisActivity[],
  scope: AnalysisScope,
  now: Date,
  planContext?: RunReviewPlanContext
): AnalysisInput {
  const nowMs = now.getTime();
  const totalDistance = activities.reduce((sum, a) => sum + a.distance, 0);
  const longest = activities.reduce((max, a) => Math.max(max, a.distance), 0);
  const totalElevation = activities.reduce((sum, a) => sum + (a.totalElevationGain ?? 0), 0);

  const weeklyVolumeKm = Array.from({ length: 4 }, (_, week) => {
    const start = nowMs - (week + 1) * 7 * DAY_MS;
    const end = nowMs - week * 7 * DAY_MS;
    const meters = activities
      .filter((a) => {
        const t = ensureDate(a.startDate).getTime();
        return t > start && t <= end;
      })
      .reduce((sum, a) => sum + a.distance, 0);
    return round(meters / 1000);
  });

  // Progression metrics via the shared engine. AnalysisActivity carries no
  // activity type or HR zones — everything reaching this path is a run.
  const snapshot = computeSnapshot(
    activities.map((a) => ({
      type: "Run",
      distance: a.distance,
      movingTime: a.movingTime,
      averageHeartrate: a.averageHeartrate ?? null,
      hrZones: null,
      startDate: a.startDate,
    })),
    now
  );
  const progression: AnalysisProgression = {
    hasFullWindow: snapshot.hasFullWindow,
    loadRatio: snapshot.trainingLoad.ratio !== null ? round(snapshot.trainingLoad.ratio, 2) : null,
    loadRisk: snapshot.trainingLoad.risk,
    volumeKm: snapshot.volumeKm !== null ? round(snapshot.volumeKm) : null,
    readyToIncrease: snapshot.readyToIncrease,
  };

  const last7 = activities.filter((a) => ensureDate(a.startDate).getTime() > nowMs - 7 * DAY_MS);
  const prev7 = activities.filter(
    (a) =>
      ensureDate(a.startDate).getTime() > nowMs - 14 * DAY_MS &&
      ensureDate(a.startDate).getTime() <= nowMs - 7 * DAY_MS
  );

  return {
    scope,
    totalRuns: activities.length,
    totalDistanceKm: round(totalDistance / 1000),
    longestRunKm: round(longest / 1000),
    totalElevationM: Math.round(totalElevation),
    weeklyVolumeKm,
    avgPaceLast7: windowPace(last7),
    avgPacePrev7: windowPace(prev7),
    avgHrLast7: windowHr(last7),
    avgHrPrev7: windowHr(prev7),
    progression,
    ...(planContext ? { planContext } : {}),
  };
}

/** Format seconds-per-km as `m:ss` (mirrors metrics.formatPace, which takes m/s). */
export function formatPaceSecPerKm(secondsPerKm: number | null): string {
  if (secondsPerKm === null || secondsPerKm <= 0) return "--:--";
  return formatPace(1000 / secondsPerKm);
}

// ---------------------------------------------------------------------------
// Deterministic blocks
// ---------------------------------------------------------------------------

/** Percentage change a→b, guarding divide-by-zero. */
function pct(from: number, to: number): number {
  if (from <= 0) return to > 0 ? 100 : 0;
  return Math.round(((to - from) / from) * 100);
}

/** 4-week volume that counts as a milestone worth celebrating. */
const MILESTONE_VOLUME_KM = 100;

/**
 * The deterministic coach message for the current progression state, or null
 * when there's nothing worth saying (or under 4 weeks of history — the engine's
 * "never guess" rule). Priority: risk warning > volume milestone > headroom
 * insight.
 */
export function coachInsightBlock(input: AnalysisInput): AnalysisBlockOf<"coachInsight"> | null {
  const { hasFullWindow, loadRatio, loadRisk, volumeKm, readyToIncrease } = input.progression;
  if (!hasFullWindow) return null;

  if ((loadRisk === "elevated" || loadRisk === "high") && loadRatio !== null) {
    const pctChange = Math.round((loadRatio - 1) * 100);
    const riskLabel = loadRisk === "high" ? "høj" : "forhøjet";
    return {
      tool: "coachInsight",
      type: "warning",
      title: "Belastningen stiger hurtigt",
      body: `Dine sidste 7 dage bærer ${loadRatio}× træningsbelastningen fra dit 4-ugers fundament — det er ${riskLabel} skadesrisiko-zone.`,
      data: {
        label: "Belastningsforhold",
        value: loadRatio.toFixed(2),
        direction: "up",
        changeLabel: `${pctChange >= 0 ? "+" : ""}${pctChange}%`,
      },
      action: "Planlæg en rolig uge",
    };
  }

  if (volumeKm !== null && volumeKm >= MILESTONE_VOLUME_KM) {
    return {
      tool: "coachInsight",
      type: "milestone",
      title: "100 km-måned låst op",
      body: `${volumeKm} km over de sidste 4 uger — et seriøst aerobt fundament, som de fleste løbere aldrig bygger.`,
      data: { label: "4-ugers volumen", value: `${volumeKm} km`, direction: "up" },
      action: "Hold stimen i gang",
    };
  }

  if (readyToIncrease === true) {
    return {
      tool: "coachInsight",
      type: "insight",
      title: "Plads til at bygge",
      body: "Din træningsbelastning ligger i det optimale bånd, så kroppen absorberer arbejdet — du kan trygt øge mængden denne uge.",
      data: {
        label: "Belastningsforhold",
        value: loadRatio !== null ? loadRatio.toFixed(2) : "optimal",
        direction: "flat",
      },
      action: "Øg med op til 10% denne uge",
    };
  }

  return null;
}

const HOUR_MS = 3_600_000;

/** Days until the race as a Danish time phrase — "i morgen", "om 74 dage". */
function daysToRaceText(days: number): string {
  if (days <= 0) return "på racedagen";
  if (days === 1) return "i morgen";
  return `om ${days} dage`;
}

/**
 * How the run's pace sits against the last seven days, as a Danish clause.
 * The "eneste tur i den seneste uge" claim is only made when the run actually
 * falls in that window: `avgPaceLast7` is null both when the run is the window's
 * only pace sample and when the run is not in the window at all.
 */
function paceComparison(
  secondsPerKm: number,
  recentAvg: number | null,
  runDate: Date,
  now: Date
): string {
  if (recentAvg !== null) {
    const delta = Math.round(secondsPerKm - recentAvg);
    const recentLabel = `${formatPaceSecPerKm(recentAvg)} /km`;
    if (Math.abs(delta) <= 3) return `på niveau med dit 7-dages snit på ${recentLabel}`;
    if (delta < 0)
      return `${Math.abs(delta)} sek. hurtigere end dit 7-dages snit på ${recentLabel}`;
    return `${delta} sek. langsommere end dit 7-dages snit på ${recentLabel}`;
  }
  const age = now.getTime() - runDate.getTime();
  if (age >= 0 && age < 7 * DAY_MS) return "den eneste tur i den seneste uge";
  if (age >= 7 * DAY_MS) return `turen var for ${Math.floor(age / DAY_MS)} dage siden`;
  return "turen ligger uden for de seneste 7 dage";
}

/**
 * The per-run review (#298) — the coach's read of the runner's latest run,
 * grounded entirely in the engine's plan context: the run's own numbers, how it
 * compares to the last seven days, and which of the week's three suggestions is
 * next (the type `recommendWorkout` landed on). Inside the recovery window the
 * review holds the day as hvile and points at nothing — the same decision the
 * recommender made. Null without context or a last run, so context-free callers
 * see exactly the feed they saw before. `now` is a parameter: same input, same
 * block, byte for byte.
 */
export function runReviewBlock(
  input: AnalysisInput,
  now: Date
): AnalysisBlockOf<"runReview"> | null {
  const context = input.planContext;
  const run = context?.lastRun;
  if (!context || !run || input.totalRuns === 0) return null;

  const runDate = ensureDate(run.startDate);
  const weekday = DA_WEEKDAYS[getLocalDate(runDate).getDay()];
  const resting = context.recommended.type === "rest";
  const suggestion = resting
    ? null
    : (context.suggestions.find((s) => s.type === context.recommended.type) ?? null);

  const metricParts = [`${formatPaceSecPerKm(run.paceSecPerKm)} /km`];
  if (run.averageHeartrate !== null && run.averageHeartrate > 0) {
    metricParts.push(`${run.averageHeartrate} bpm`);
  }

  const raceClause = context.raceLabel
    ? ` frem mod ${context.raceLabel}${
        context.daysToRace !== null ? ` ${daysToRaceText(context.daysToRace)}` : ""
      }`
    : "";
  const planSentence = `Du er i ${context.phaseLabel}-fasen${raceClause}, og din readiness er ${
    context.readiness.pct
  }% (${context.readiness.note.toLowerCase()}).`;

  const recommendation = resting
    ? `I dag holder vi hviledag: ${context.recommended.reason}`
    : suggestion
      ? `Dagens pas bliver ${suggestion.description.toLowerCase()} (${formatDanish(
          suggestion.distanceKm
        )} km): ${context.recommended.reason}`
      : context.recommended.reason;

  const earliest = new Date(runDate.getTime() + context.recoveryHours * HOUR_MS);
  const windowActive = now.getTime() < earliest.getTime();
  const nextRunDay = DA_WEEKDAYS[getLocalDate(earliest).getDay()].toLowerCase();
  let nextRunLabel: string;
  if (windowActive) {
    nextRunLabel = resting
      ? `Næste løb: ${nextRunDay} · hviledag nu — tidligst ${context.recoveryHours} timer efter turen`
      : `Næste løb: ${nextRunDay} · tidligst ${context.recoveryHours} timer efter turen`;
  } else {
    nextRunLabel = resting
      ? `Næste løb: hviledag i dag — ${context.recommended.reason}`
      : "Næste løb: i dag · recovery-vinduet er klaret";
  }

  const suggestedRun = suggestion
    ? `${suggestion.label} · ${formatDanish(suggestion.distanceKm)} km · ${
        suggestion.paceRange.min
      }–${suggestion.paceRange.max} /km`
    : null;

  return {
    tool: "runReview",
    title: `${weekday}sturen · ${formatDanish(run.distanceKm)} km`,
    metric: metricParts.join(" · "),
    body: `Turen tog ${formatDuration(run.movingTimeSec)} — ${paceComparison(
      run.paceSecPerKm,
      input.avgPaceLast7,
      runDate,
      now
    )}. ${planSentence} ${recommendation}`,
    nextRunLabel,
    suggestedRun,
  };
}

/**
 * Build typed blocks from arithmetic alone — the whole analysis. Ordered
 * most-important first: what changed, what it means, and what to do next.
 * `now` is optional (#298) and only feeds the per-run review; callers without a
 * plan context, or without a clock, get exactly the blocks they always did.
 */
export function heuristicBlocks(input: AnalysisInput, now?: Date): AnalysisBlock[] {
  const blocks: AnalysisBlock[] = [];

  // 0) The per-run review (#298) — the coach opens with the newest run before
  // the aggregate trend cards, since it is the most concrete event in the feed.
  const review = now ? runReviewBlock(input, now) : null;
  if (review) blocks.push(review);

  const [thisWeek = 0, lastWeek = 0] = input.weeklyVolumeKm;

  // 1) Volume trend, this week vs last.
  const volChange = pct(lastWeek, thisWeek);
  const volDirection = volChange > 4 ? "up" : volChange < -4 ? "down" : "flat";
  blocks.push({
    tool: "trendCallout",
    title: "Ugentligt volumen",
    direction: volDirection,
    changeLabel: `${volChange >= 0 ? "+" : ""}${volChange}%`,
    metric: `${thisWeek} km i denne uge`,
    body:
      volDirection === "up"
        ? "Du bygger mængde — hold stigningen under ~10% fra uge til uge for at undgå skader."
        : volDirection === "down"
          ? "Volumen faldt denne uge, hvilket er fint, hvis det var en planlagt restitutionsuge."
          : "Volumen holdt stabilt — et solidt, holdbart fundament at bygge videre på.",
  });

  // 2) Pace comparison, last 7 vs prior 7 days.
  if (input.avgPaceLast7 !== null && input.avgPacePrev7 !== null) {
    const delta = input.avgPaceLast7 - input.avgPacePrev7; // negative = faster
    const faster = delta < 0;
    // Round to whole seconds BEFORE splitting into m:ss — rounding the
    // remainder alone can yield ":60" (e.g. 59.6 s → 0:60).
    const absDelta = Math.round(Math.abs(delta));
    const deltaMin = Math.floor(absDelta / 60);
    const deltaSec = absDelta % 60;
    blocks.push({
      tool: "metricComparison",
      title: "Gennemsnitsfart: sidste 7 dage vs forrige",
      metric: "Gennemsnitsfart",
      current: `${formatPaceSecPerKm(input.avgPaceLast7)} /km`,
      previous: `${formatPaceSecPerKm(input.avgPacePrev7)} /km`,
      deltaLabel: `${faster ? "−" : "+"}${deltaMin}:${deltaSec.toString().padStart(2, "0")}`,
      better: Math.abs(delta) < 3 ? "flat" : faster ? "up" : "down",
    });
  }

  // 3) A grounded headline insight.
  blocks.push({
    tool: "insightCard",
    title: "Træningsbelastning",
    metric: `${input.totalDistanceKm} km`,
    sentiment: input.totalRuns >= 8 ? "positive" : "neutral",
    body: `På ${input.totalRuns} ture har du løbet ${input.totalDistanceKm} km, med en længste tur på ${input.longestRunKm} km. ${
      input.avgHrLast7 !== null
        ? `De seneste ture lå i snit på ${input.avgHrLast7} bpm.`
        : "Tilslut en pulskilde for at låse op for zoneanalyse."
    }`,
  });

  // 4) A concrete next session, tuned to the volume trend.
  const recoveryPace =
    input.avgPaceLast7 !== null ? formatPaceSecPerKm(Math.round(input.avgPaceLast7 * 1.12)) : null;
  const tempoPace =
    input.avgPaceLast7 !== null ? formatPaceSecPerKm(Math.round(input.avgPaceLast7 * 0.92)) : null;
  if (volDirection === "up") {
    blocks.push({
      tool: "workoutRecommendation",
      title: "Rolig restitutions-tur",
      workoutType: "Restitution",
      details: `40 min afslappet${recoveryPace ? ` omkring ${recoveryPace} /km` : ""}`,
      rationale:
        "Du øger mængden — læg en rolig dag ind for at absorbere belastningen før næste hårde pas.",
      ...(recoveryPace ? { targetPace: `${recoveryPace} /km` } : {}),
      distanceKm: 7,
    });
  } else {
    blocks.push({
      tool: "workoutRecommendation",
      title: "Tempo-intervaller",
      workoutType: "Tempo",
      details: `4 × 1 km${tempoPace ? ` @ ${tempoPace} /km` : ""} med 90 sek. rolig jog imellem`,
      rationale:
        "Volumen er stabilt, så det er et godt tidspunkt at tilføje kvalitet og skærpe din tærskel.",
      ...(tempoPace ? { targetPace: `${tempoPace} /km` } : {}),
      distanceKm: 8,
    });
  }

  // 5) The coach message, when the progression data warrants one.
  const coach = coachInsightBlock(input);
  if (coach) blocks.push(coach);

  return blocks;
}
