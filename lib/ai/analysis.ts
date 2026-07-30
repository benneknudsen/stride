/**
 * Analysis input shaping, deduplication hashing, prompting, and a deterministic
 * heuristic fallback.
 *
 * The model is expensive and rate-limited, so we reduce raw activities to a
 * compact, rounded summary (`AnalysisInput`) and hash it — identical training
 * data yields an identical `inputHash`, which the analyze route uses to dedupe
 * against the `ai_analyses` cache.
 *
 * When no provider is configured (`isAIConfigured() === false`), `heuristicBlocks`
 * produces the same typed blocks from arithmetic alone, so the public demo
 * renders a real, data-grounded analysis without any AI key.
 */

import { createHash } from "node:crypto";
import { ensureDate } from "@/lib/db/calendar-date";
import { formatPace } from "@/lib/metrics";
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
 * cadence). The reads that feed the AI (`getActivities`, `getDashboardActivities`)
 * filter by `userId` only, never by `source`, so the coach sees every synced run
 * regardless of origin. That is why nothing here needs a `source` field. Add
 * provider-specific inputs here only if a metric ever becomes source-dependent.
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
export interface AnalysisProgression {
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

/** A compact, rounded summary of an athlete's training — the model's context. */
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
 * hash is reproducible in tests; production passes the request time.
 */
export function buildAnalysisInput(
  activities: AnalysisActivity[],
  scope: AnalysisScope,
  now: Date
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
  };
}

/** Stable SHA-256 of the summary — the cache key (`ai_analyses.inputHash`). */
export function analysisInputHash(input: AnalysisInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

export const ANALYSIS_SYSTEM_PROMPT = [
  "You are Stride, an elite running coach analysing a runner's recent training.",
  "You communicate exclusively through structured UI blocks — never prose.",
  "Produce 3 to 5 blocks total, ordered most-important first.",
  "Ground every statement in the provided numbers; never invent data.",
  "Favour a mix of block types: at least one trend or comparison, and one workout recommendation.",
  "Be specific and encouraging but honest about regressions. Use pace as min:sek /km.",
  // Hard language rule (issue #210): the entire product is Danish, so every
  // user-facing field the model emits — titles, bodies, metrics, labels,
  // workout types and recommendations — MUST be written in Danish, addressing
  // the runner as 'du'. This mirrors how the chat route enforces Danish. Never
  // emit English in any field; translate running terminology naturally
  // (fx "tempo", "intervaller", "langtur", "rolig tur", "/km" for fart).
  "SVAR ALTID PÅ DANSK. Skriv ALLE titler, sætninger, metrics, labels, pas-typer og anbefalinger på dansk, og sig 'du' til brugeren. Brug aldrig engelsk i noget felt.",
].join(" ");

/** Build the user prompt from the summarised input. */
export function buildAnalysisPrompt(input: AnalysisInput): string {
  const paceLine = (p: number | null) => (p === null ? "n/a" : formatPaceSecPerKm(p));
  return [
    `Scope: ${input.scope}`,
    `Total runs: ${input.totalRuns}`,
    `Total distance: ${input.totalDistanceKm} km`,
    `Longest run: ${input.longestRunKm} km`,
    `Total elevation gain: ${input.totalElevationM} m`,
    `Weekly volume (km, newest first): ${input.weeklyVolumeKm.join(", ")}`,
    `Avg pace last 7 days: ${paceLine(input.avgPaceLast7)}`,
    `Avg pace prior 7 days: ${paceLine(input.avgPacePrev7)}`,
    `Avg HR last 7 days: ${input.avgHrLast7 ?? "n/a"} bpm`,
    `Avg HR prior 7 days: ${input.avgHrPrev7 ?? "n/a"} bpm`,
    `Training load ratio (acute:chronic): ${input.progression.loadRatio ?? "n/a"} (risk: ${input.progression.loadRisk ?? "n/a"})`,
    `4-week volume: ${input.progression.volumeKm ?? "n/a"} km`,
    `Ready to increase volume: ${input.progression.readyToIncrease ?? "unknown"}`,
  ].join("\n");
}

/** Format seconds-per-km as `m:ss` (mirrors metrics.formatPace, which takes m/s). */
export function formatPaceSecPerKm(secondsPerKm: number | null): string {
  if (secondsPerKm === null || secondsPerKm <= 0) return "--:--";
  return formatPace(1000 / secondsPerKm);
}

// ---------------------------------------------------------------------------
// Deterministic heuristic fallback (no AI key required)
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

/**
 * Build typed blocks from arithmetic alone. Used when no provider is configured
 * (the public demo) and as the guaranteed floor if the model errors out.
 */
export function heuristicBlocks(input: AnalysisInput): AnalysisBlock[] {
  const blocks: AnalysisBlock[] = [];
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
