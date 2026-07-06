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
import { formatPace } from "@/lib/metrics";
import { computeSnapshot, type LoadRisk } from "@/lib/training/progression";
import type { AnalysisScope } from "@/types/domain";
import type { AnalysisBlock, AnalysisBlockOf } from "./tools";

// ---------------------------------------------------------------------------
// Input shaping
// ---------------------------------------------------------------------------

/** The minimal per-activity fields the analysis reasons over. */
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
      .filter((a) => a.startDate.getTime() > start && a.startDate.getTime() <= end)
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

  const last7 = activities.filter((a) => a.startDate.getTime() > nowMs - 7 * DAY_MS);
  const prev7 = activities.filter(
    (a) =>
      a.startDate.getTime() > nowMs - 14 * DAY_MS && a.startDate.getTime() <= nowMs - 7 * DAY_MS
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
  "Be specific and encouraging but honest about regressions. Use pace as min:sec /km.",
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
    return {
      tool: "coachInsight",
      type: "warning",
      title: "Load is climbing fast",
      body: `Your last 7 days carry ${loadRatio}× the training load of your 4-week base — that's ${loadRisk} injury-risk territory.`,
      data: {
        label: "Load ratio",
        value: loadRatio.toFixed(2),
        direction: "up",
        changeLabel: `${Math.round((loadRatio - 1) * 100) >= 0 ? "+" : ""}${Math.round((loadRatio - 1) * 100)}%`,
      },
      action: "Plan an easy week",
    };
  }

  if (volumeKm !== null && volumeKm >= MILESTONE_VOLUME_KM) {
    return {
      tool: "coachInsight",
      type: "milestone",
      title: "100 km month unlocked",
      body: `${volumeKm} km over the last 4 weeks — a serious aerobic base most runners never build.`,
      data: { label: "4-week volume", value: `${volumeKm} km`, direction: "up" },
      action: "Keep the streak going",
    };
  }

  if (readyToIncrease === true) {
    return {
      tool: "coachInsight",
      type: "insight",
      title: "Room to build",
      body: "Your training load sits in the optimal band, so your body is absorbing the work — you can safely add volume this week.",
      data: {
        label: "Load ratio",
        value: loadRatio !== null ? loadRatio.toFixed(2) : "optimal",
        direction: "flat",
      },
      action: "Add up to 10% this week",
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
    title: "Weekly volume",
    direction: volDirection,
    changeLabel: `${volChange >= 0 ? "+" : ""}${volChange}%`,
    metric: `${thisWeek} km this week`,
    body:
      volDirection === "up"
        ? "You're building load — keep the increase under ~10% week-over-week to stay injury-free."
        : volDirection === "down"
          ? "Volume eased off this week, which is fine if it was a planned recovery block."
          : "Volume held steady — a solid, sustainable base to build from.",
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
      title: "Average pace: last 7 days vs prior",
      metric: "Average pace",
      current: `${formatPaceSecPerKm(input.avgPaceLast7)} /km`,
      previous: `${formatPaceSecPerKm(input.avgPacePrev7)} /km`,
      deltaLabel: `${faster ? "−" : "+"}${deltaMin}:${deltaSec.toString().padStart(2, "0")}`,
      better: Math.abs(delta) < 3 ? "flat" : faster ? "up" : "down",
    });
  }

  // 3) A grounded headline insight.
  blocks.push({
    tool: "insightCard",
    title: "Training load",
    metric: `${input.totalDistanceKm} km`,
    sentiment: input.totalRuns >= 8 ? "positive" : "neutral",
    body: `Across ${input.totalRuns} runs you've covered ${input.totalDistanceKm} km, with a longest run of ${input.longestRunKm} km. ${
      input.avgHrLast7 !== null
        ? `Recent runs averaged ${input.avgHrLast7} bpm.`
        : "Connect a heart-rate source to unlock zone analysis."
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
      title: "Easy recovery run",
      workoutType: "Recovery",
      details: `40 min relaxed${recoveryPace ? ` around ${recoveryPace} /km` : ""}`,
      rationale:
        "You're ramping volume — bank an easy day to absorb the load before the next hard session.",
      ...(recoveryPace ? { targetPace: `${recoveryPace} /km` } : {}),
      distanceKm: 7,
    });
  } else {
    blocks.push({
      tool: "workoutRecommendation",
      title: "Tempo intervals",
      workoutType: "Tempo",
      details: `4 × 1 km${tempoPace ? ` @ ${tempoPace} /km` : ""} with 90s easy jog between`,
      rationale:
        "Volume is steady, so it's a good window to add quality and sharpen your threshold.",
      ...(tempoPace ? { targetPace: `${tempoPace} /km` } : {}),
      distanceKm: 8,
    });
  }

  // 5) The coach message, when the progression data warrants one.
  const coach = coachInsightBlock(input);
  if (coach) blocks.push(coach);

  return blocks;
}
