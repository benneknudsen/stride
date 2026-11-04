export type PhaseKey = "adapt" | "burn" | "sharpen" | "peak" | "taper";

export interface PhaseRules {
  phase: PhaseKey;
  startDate: Date;
  endDate: Date;
  sessionsPerWeek: number;
  zone2Required: boolean;
  minDistanceKm: number;
  maxDistanceKm: number;
  hasTempoSession: boolean;
  hasLongRun: boolean;
  longRunMaxKm: number;
}

/**
 * The engine's severity vocabulary — `hard` blocks, `soft`/`phase`/`safety`
 * advise. Exported so consumers can read a {@link ConstraintTrace} row's own
 * severity alongside its status.
 */
export type Severity = "hard" | "soft" | "phase" | "safety";

/**
 * A caller-supplied risk level for the planned session (issue #76 B2). Distinct
 * from the load-derived `LoadRisk` band — this is the recommender's own read on
 * how cautious to be (e.g. after football or during a taper). "high" nudges the
 * validator toward keeping the session easy.
 */
export type SessionRisk = "low" | "medium" | "high";

/**
 * The canonical session-type vocabulary the plan works in — the single source
 * of truth. Run days carry an effort (easy → race); the rest are non-run days.
 * {@link SessionType} is its element type, so callers take the type, never the
 * array (issue #283: nothing outside this file reads the array itself).
 * Loosely-typed strings (form input, webhook payloads) get normalised at the
 * boundary; `normalizeType` in `constraints.ts` still tolerates casing.
 */
const SESSION_TYPES = [
  "easy",
  "recovery",
  "tempo",
  "intervals",
  "fartlek",
  "speed",
  "long",
  "race",
  "rest",
  "strength",
  "cross",
  "off",
  "mobility",
  "yoga",
] as const;

export type SessionType = (typeof SESSION_TYPES)[number];

export interface Constraint {
  id: string;
  /** Short Danish name for the rule, used by the trace UI. */
  label: string;
  description: string;
  severity: Severity;
  category: string;
  evaluate(context: WorkoutContext): ValidationIssue | null;
}

export interface WorkoutContext {
  plannedDate: Date;
  plannedType?: SessionType;
  plannedDistanceKm?: number;
  plannedPace?: string;
  plannedZone?: number;
  shoeType?: string; // "vomero" | "adios_pro" | etc.
  includesStrength?: boolean;
  lastRunDate?: Date;
  lastRunDistanceKm?: number;
  footballYesterday?: boolean;
  phase: PhaseKey;
  weeklyDistanceKm?: number;
  previousWeekDistanceKm?: number;
  /** Caller's risk read for this session; "high" wants the effort kept easy. */
  risk?: SessionRisk;
  /** The user's race date (issue #99); omitted → {@link DEFAULT_RACE_DATE}. */
  raceDate?: Date;
}

export interface ValidationIssue {
  constraintId: string;
  severity: Severity;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
}

// ── Tunable limits ──────────────────────────────────────────────────────────

/**
 * The demo/fallback race — Silkeborg Halvmarathon, 20 Sep 2026. The engine is
 * parameterised on the race date (issue #99); this default keeps every
 * unauthenticated/demo path on the original plan. The only remaining date
 * literal — user paths thread their own `users.race_date` through instead.
 */
export const DEFAULT_RACE_DATE = new Date(2026, 8, 20); // 20 Sep 2026

/** Display name for the demo/fallback race. */
export const DEFAULT_RACE_NAME = "Silkeborg Halvmarathon";

/**
 * The race the plan builds toward — the distance `getWeekPlan` in `week-plan.ts`
 * prescribes on race day. It lives here, in the shared types module, and
 * `lib/training/prediction` re-exports it: this file is deliberately a
 * dependency-free leaf, and importing the predictor's copy would close the loop
 * engine → prediction → metrics → engine.
 */
export const HALF_MARATHON_KM = 21.0975;

/** Absolute Zone 2 heart-rate ceiling in bpm — a fixed number, NOT a %HRmax. */
export const ZONE2_CEILING_BPM = 155;

/**
 * Minimum recovery window before a QUALITY session (tempo/intervals/race), in
 * hours. Easy runs only need {@link EASY_MIN_RECOVERY_HOURS} — a strict 48 h
 * gap between every run would make the 5-session sharpen/peak weeks impossible
 * (at most 4 runs fit in 7 days with 48 h spacing).
 */
export const MIN_RECOVERY_HOURS = 48;

/** Minimum recovery window before an easy / long (Zone 2) run, in hours. */
export const EASY_MIN_RECOVERY_HOURS = 24;

/** Largest safe week-over-week distance growth (10%). */
export const MAX_WEEKLY_INCREASE_RATIO = 1.1;

/** Monday-first weekday keys — the plan always runs Mon → Sun. */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * How an easy Zone-2 run is shaped within the week (issue #211). The `type` stays
 * `"easy"` — this refines it so the week reads as a varied progression rather than
 * four identical jogs: a short `recovery` day sits after a hard effort, an
 * `easy-strides` day carries the strides before the long run, and `easy`/`medium`
 * alternate to give the volume a short/long wave.
 */
export type EasySubtype = "recovery" | "easy" | "easy-strides" | "medium";

/** One day in a generated training week. Non-run days carry `type: "rest"`. */
export interface PlannedSession {
  weekday: Weekday;
  /** Concrete calendar date — only set when `getWeekPlan` is given a week start. */
  date?: Date;
  type: SessionType;
  /** Refines an `easy` run into recovery/easy/strides/medium (issue #211). */
  easySubtype?: EasySubtype;
  /** Target HR zone for run days. */
  zone?: number;
  distanceKm?: number;
  description: string;
}

/**
 * A rule's verdict for one {@link WorkoutContext}: `blocked` (a hard issue),
 * `warning` (soft/phase/safety — advisory, exactly what `validateWorkout` puts
 * in `warnings`), `passed` (evaluated, nothing to report) or `not-applicable`
 * (filtered out for the phase by `getActiveConstraints` in `constraints.ts`).
 */
export type ConstraintTraceStatus = "passed" | "warning" | "blocked" | "not-applicable";

/** One row of the rule trace — the engine's whole rule set for one context. */
export interface ConstraintTrace {
  id: string;
  category: string;
  severity: Severity;
  status: ConstraintTraceStatus;
  /** Short Danish name for the rule. */
  label: string;
  /** The rule's description when it passed / was out of play, else its message. */
  detail: string;
  /** The issue's remedy, when the rule raised one. */
  suggestion?: string;
}

// ── Client serialization ──────────────────────────────────────────────────────

/**
 * A `ValidationResult` flattened for the client boundary (plain JSON, no
 * `undefined` gaps across a server→client prop) with a ready-to-render
 * `summary` line added.
 */
interface SerializedValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
  /** One-line Danish headline for the UI. */
  summary: string;
}

function summarizeValidation(result: ValidationResult): string {
  if (!result.valid) {
    const n = result.issues.length;
    return `${n} blokerende ${n === 1 ? "problem" : "problemer"}`;
  }
  if (result.warnings.length > 0) {
    const n = result.warnings.length;
    return `Godkendt med ${n} ${n === 1 ? "advarsel" : "advarsler"}`;
  }
  return "Godkendt";
}

/** Flatten a `ValidationResult` into a plain, JSON-safe shape for the client. */
export function serializeValidationResult(result: ValidationResult): SerializedValidationResult {
  return {
    valid: result.valid,
    issues: result.issues,
    warnings: result.warnings,
    summary: summarizeValidation(result),
  };
}
