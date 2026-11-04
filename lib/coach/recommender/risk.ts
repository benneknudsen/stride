// Stride — the risk and recovery step for the workout recommender (issue #347).
// It reads the athlete's current state and returns one small, named assessment:
// recovery buffer, load risk, readiness and the week's volume budget.
//
// The conflict (#330) is deliberate: readiness maps the acute:chronic ratio to
// freshness and can say "easy" at ratio 1.6 while the dashboard's load risk
// says high — the risk read must win the prescription.
//
// Pure and deterministic: the clock and the athlete state are inputs.

import {
  EASY_MIN_RECOVERY_HOURS,
  MIN_RECOVERY_HOURS,
  type PlannedSession,
} from "@/lib/coach/engine";
import type { WorkoutInput } from "@/lib/coach/recommender";
import { type DayShapeGate, dayShapeGate } from "@/lib/coach/run-character";
import { readinessFromRatio } from "@/lib/cobalt/readiness";
import { daysUntilRiskFalls, type TrainingLoad } from "@/lib/training/progression";

/** The run types the recommender can prescribe after the slot is read. */
export type RunType = "easy" | "tempo" | "long";

/** Recovery buffer when the athlete has an injury history: one extra day. */
export const INJURY_RECOVERY_HOURS = 72;

/**
 * A break this long or longer counts as a long pause — restart 20% shorter.
 * Not the same concept as `PAUSE_RESTART_DAYS` (3) in `run-character.ts`: that
 * one describes *today's form* after a short break and only gates the day
 * shape; this one scales the whole restart down.
 */
export const PAUSE_DAYS = 14;

/**
 * Share of the phase week's intended volume the week may reach before holding
 * back. The engine's `MAX_WEEKLY_INCREASE_RATIO` is a separate, week-over-week
 * guard; this one is week-against-plan. Every distance clamp is a `Math.min`.
 */
const WEEKLY_VOLUME_RATIO = 1;

const HOUR_MS = 3_600_000;

/** Hours between two instants, clamped to ≥ 0 (a clock ahead of UTC cannot go negative). */
export function hoursSince(from: Date, now: Date): number {
  return Math.max(0, (now.getTime() - from.getTime()) / HOUR_MS);
}

/** The week's volume budget, prorated to the elapsed days (#256/#261). */
export interface WeekBudget {
  intendedWeeklyKm: number;
  proratedWeeklyKm: number;
  weekBudgetKm: number;
  weekToDateKm: number | null;
  weekLoadKnown: boolean;
}

export interface StateInput {
  input: WorkoutInput;
  now: Date;
  slotType: RunType;
  dayOfWeek: number;
  weekPlan: readonly PlannedSession[];
}

export interface StateAssessment {
  recoveryHours: number;
  gapHours: number;
  longPause: boolean;
  /** The slot's own type — what the recovery gate reads. */
  slotType: RunType;
  /** The type after elevated risk, football and readiness have softened it. */
  type: RunType;
  highRiskReason: string | null;
  elevatedReason: string | null;
  footballReason: string | null;
  readiness: ReturnType<typeof readinessFromRatio>;
  readinessReason: string;
  dayShape: DayShapeGate | null;
  week: WeekBudget;
}

/** " (1,6× dit 4-ugers fundament)" — Danish decimal comma for the load ratio. */
function loadRatioClause(load: TrainingLoad): string {
  if (load.ratio === null) return "";
  const ratio = load.ratio.toFixed(1).replace(".", ",");
  return ` (${ratio}× dit 4-ugers fundament)`;
}

/**
 * The reason a high acute:chronic risk forces rest (#330). This is a *risk*
 * guard, not a restatement of the readiness band: readiness maps the same ratio
 * to freshness, while the risk band says the runner is in the injury-risk zone.
 * The countdown comes from `daysUntilRiskFalls` — deterministic, and it only
 * claims when the classification drops, not when the runner is recovered.
 */
function highRiskRestReason(load: TrainingLoad): string {
  const days = daysUntilRiskFalls(load);
  const countdown =
    days === null
      ? ""
      : ` Uden løb falder belastningen under høj-risiko om ${days} ${days === 1 ? "dag" : "dage"}.`;
  return `Høj skadesrisiko${loadRatioClause(load)}: et nyt pas er ikke forsvarligt. Kroppen skal have restitution.${countdown}`;
}

/** The softened reason for the elevated band (#330): a caution, not a stop. */
function elevatedRiskReason(load: TrainingLoad): string {
  return `Belastningen er forhøjet${loadRatioClause(load)} — tempopasset bliver en rolig Zone 2-tur, så risikoen ikke stiger.`;
}

/** The readiness rest line — one formulation for the rest card and the gate. */
export function readinessRestReason(readiness: StateAssessment["readiness"]): string {
  return `Din readiness er på ${readiness.pct}% — ${readiness.note.toLowerCase()}. Din krop har brug for restitution i dag.`;
}

/** One decimal, for Danish reason copy — "32,5 km", never "32,499999 km". */
export function round1(km: number): number {
  return Math.round(km * 10) / 10;
}

/**
 * Step 2: recovery, load risk and readiness. The recovery hours come from the
 * slot's own effort, before any gate softens it.
 */
export function assessState(input: StateInput): StateAssessment {
  const { input: workout } = input;
  const load = workout.progression.trainingLoad;
  const loadRisk = load.risk;
  const highRiskReason = loadRisk === "high" ? highRiskRestReason(load) : null;

  // Recovery depends on the slot's own effort, not on a gate that may soften it.
  const recoveryHours = workout.injuryHistory
    ? INJURY_RECOVERY_HOURS
    : input.slotType === "tempo"
      ? MIN_RECOVERY_HOURS
      : EASY_MIN_RECOVERY_HOURS;
  const gapHours = hoursSince(workout.lastRun, input.now);
  const longPause = gapHours >= PAUSE_DAYS * 24;

  let type = input.slotType;
  let elevatedReason: string | null = null;
  if (loadRisk === "elevated" && type === "tempo") {
    type = "easy";
    elevatedReason = elevatedRiskReason(load);
  }

  let footballReason: string | null = null;
  if (type === "tempo" && workout.footballYesterday) {
    type = "easy";
    footballReason =
      "Fodboldkamp i går — benene er forbelastede, så tempoturen bliver en rolig Zone 2-tur.";
  }

  const readiness = readinessFromRatio(load.ratio);
  let readinessReason: string;
  if (readiness.band === "easy") {
    type = "easy";
    readinessReason = `Din readiness er på ${readiness.pct}% — ${readiness.note.toLowerCase()}. Overvej en rolig tur i dag frem for et hårdt pas.`;
  } else {
    readinessReason = `Din readiness er på ${readiness.pct}% — du er klar til dagens pas.`;
  }

  const dayShape = dayShapeGate({
    character: workout.lastRunSummary?.character ?? null,
    gapHours,
  });

  const intendedWeeklyKm = input.weekPlan.reduce((sum, day) => sum + (day.distanceKm ?? 0), 0);
  const weekFraction = Math.min(1, (input.dayOfWeek + 1) / 7);
  const proratedWeeklyKm = intendedWeeklyKm * weekFraction;
  const weekToDateKm = workout.weekToDateKm ?? null;
  const weekLoadKnown = weekToDateKm !== null && intendedWeeklyKm > 0;

  return {
    recoveryHours,
    gapHours,
    longPause,
    slotType: input.slotType,
    type,
    highRiskReason,
    elevatedReason,
    footballReason,
    readiness,
    readinessReason,
    dayShape,
    week: {
      intendedWeeklyKm,
      proratedWeeklyKm,
      weekBudgetKm: proratedWeeklyKm * WEEKLY_VOLUME_RATIO,
      weekToDateKm,
      weekLoadKnown,
    },
  };
}
