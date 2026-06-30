// Stride — coach rule engine. The single source of truth for the periodised
// build toward the Silkeborg Halvmarathon (20 Sep 2026) and the constraint set
// the AI coach must respect when it proposes or validates a workout.
//
// Two halves:
//   1. Phases — four dated training blocks (adapt → burn → sharpen → peak),
//      each with its own session volume, Zone-2 requirement and distance caps.
//   2. Constraints — independent, self-guarding rules (hard blocks, soft
//      warnings, phase guidance, safety limits) evaluated against a single
//      WorkoutContext. `validateWorkout` runs the active set and sorts the
//      results into blocking issues vs. non-blocking warnings.
//
// Everything here is pure and deterministic — the only clock read is the
// default argument of `getCurrentPhase` — which keeps it trivially testable and
// safe to call from server actions or the AI tool layer.

export type PhaseKey = "adapt" | "burn" | "sharpen" | "peak";

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

export type Severity = "hard" | "soft" | "phase" | "safety";

export interface Constraint {
  id: string;
  description: string;
  severity: Severity;
  category: string;
  evaluate(context: WorkoutContext): ValidationIssue | null;
}

export interface WorkoutContext {
  plannedDate: Date;
  plannedType?: string; // "easy" | "tempo" | "intervals" | "long" | "race" | etc.
  plannedDistanceKm?: number;
  plannedPace?: string;
  plannedZone?: number;
  shoeType?: string; // "vomero" | "adios_pro" | etc.
  includesStrength?: boolean;
  lastRunDate?: Date;
  lastRunDistanceKm?: number;
  sleepQuality?: "good" | "ok" | "poor";
  footballYesterday?: boolean;
  phase: PhaseKey;
  weeklyDistanceKm?: number;
  previousWeekDistanceKm?: number;
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
  /** HR adjustment if sleep modifier is active */
  hrAdjustmentBpm?: number;
  /** Pace adjustment suggestion */
  paceAdjustment?: string;
}

// ── Tunable limits ──────────────────────────────────────────────────────────

/** Goal race the whole plan periodises toward — Silkeborg Halvmarathon. */
export const RACE_DATE = new Date(2026, 8, 20); // 20 Sep 2026

/** Absolute Zone 2 heart-rate ceiling in bpm — a fixed number, NOT a %HRmax. */
export const ZONE2_CEILING_BPM = 155;

/** Minimum recovery window between two runs, in hours. */
export const MIN_RECOVERY_HOURS = 48;

/** Largest safe week-over-week distance growth (10%). */
export const MAX_WEEKLY_INCREASE_RATIO = 1.1;

/** Heart-rate bump (bpm) attributed to a poor night's sleep. */
export const POOR_SLEEP_HR_BUMP_BPM = 5;

/** Pace easing suggested after poor sleep. */
export const POOR_SLEEP_PACE_ADJUSTMENT = "+10-15 sek/km";

// ── Phases ──────────────────────────────────────────────────────────────────

/**
 * The four dated training blocks. `minDistanceKm`/`maxDistanceKm` bound a
 * regular session; `longRunMaxKm` is the separate weekly long-run ceiling.
 * Sharpen/peak distances past the table's explicit 6–10 km base are sensible
 * defaults — the spec only fixes the long-run caps for those blocks.
 */
export const PHASES: Record<PhaseKey, PhaseRules> = {
  adapt: {
    phase: "adapt",
    startDate: new Date(2026, 5, 22), // 22 Jun 2026
    endDate: new Date(2026, 6, 5), // 5 Jul 2026
    sessionsPerWeek: 4,
    zone2Required: true,
    minDistanceKm: 6,
    maxDistanceKm: 8,
    hasTempoSession: false,
    hasLongRun: false,
    longRunMaxKm: 16,
  },
  burn: {
    phase: "burn",
    startDate: new Date(2026, 6, 6), // 6 Jul 2026
    endDate: new Date(2026, 7, 2), // 2 Aug 2026
    sessionsPerWeek: 4,
    zone2Required: true,
    minDistanceKm: 8,
    maxDistanceKm: 10,
    hasTempoSession: false,
    hasLongRun: false,
    longRunMaxKm: 16,
  },
  sharpen: {
    phase: "sharpen",
    startDate: new Date(2026, 7, 3), // 3 Aug 2026
    endDate: new Date(2026, 7, 23), // 23 Aug 2026
    sessionsPerWeek: 5, // 4× Z2 + 1× tempo
    zone2Required: false,
    minDistanceKm: 8,
    maxDistanceKm: 10,
    hasTempoSession: true,
    hasLongRun: false,
    longRunMaxKm: 18,
  },
  peak: {
    phase: "peak",
    startDate: new Date(2026, 7, 24), // 24 Aug 2026
    endDate: new Date(2026, 8, 14), // 14 Sep 2026
    sessionsPerWeek: 5, // 4× + long run
    zone2Required: false,
    minDistanceKm: 8,
    maxDistanceKm: 12,
    hasTempoSession: true, // sharpness from the sharpen block is maintained
    hasLongRun: true,
    longRunMaxKm: 18,
  },
};

const PHASE_ORDER: PhaseKey[] = ["adapt", "burn", "sharpen", "peak"];

/** Calendar-day key (YYYYMMDD as an int) — compares dates ignoring time-of-day. */
function dayNumber(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** The phase rules for a key. */
export function getPhase(phase: PhaseKey): PhaseRules {
  return PHASES[phase];
}

/**
 * The training phase a date falls in. Dates before the build clamp to `adapt`;
 * dates after the peak block (race week and beyond) hold at `peak`.
 */
export function getCurrentPhase(date: Date = new Date()): PhaseKey {
  const day = dayNumber(date);
  for (const key of PHASE_ORDER) {
    const phase = PHASES[key];
    if (day >= dayNumber(phase.startDate) && day <= dayNumber(phase.endDate)) {
      return key;
    }
  }
  return day < dayNumber(PHASES.adapt.startDate) ? "adapt" : "peak";
}

// ── Constraint helpers ──────────────────────────────────────────────────────

/** Session types that count as fast/quality work (Adios Pro 4 territory). */
const SPEED_SESSION_TYPES = new Set(["tempo", "intervals", "race", "fartlek", "speed"]);

/** Session types that are NOT a run — leg strength on these days is fine. */
const NON_RUN_TYPES = new Set(["rest", "strength", "cross", "off", "mobility", "yoga"]);

function isSpeedSession(type?: string): boolean {
  return type != null && SPEED_SESSION_TYPES.has(type);
}

/** A hard effort either by session type (speed work) or by target zone (≥ Z3). */
function isQualityEffort(context: WorkoutContext): boolean {
  return (
    isSpeedSession(context.plannedType) || (context.plannedZone != null && context.plannedZone >= 3)
  );
}

/** Whether the day carries a run (so leg strength would clash with it). */
function isRunDay(context: WorkoutContext): boolean {
  if (context.plannedType != null) return !NON_RUN_TYPES.has(context.plannedType);
  return context.plannedDistanceKm != null && context.plannedDistanceKm > 0;
}

/** The Adidas Adios Pro 4 — a carbon race shoe, identified loosely by name. */
function isAdiosPro(shoe?: string): boolean {
  return shoe?.toLowerCase().includes("adios") ?? false;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3_600_000;
}

// ── Constraints ─────────────────────────────────────────────────────────────

/** Puls — Zone 2 ceiling. Base phases must not exceed Zone 2. */
const zone2HrCeiling: Constraint = {
  id: "zone2-hr-ceiling",
  description: `Base phases cap effort at Zone 2 (≤ ${ZONE2_CEILING_BPM} bpm, absolute — not %HRmax).`,
  severity: "hard",
  category: "heart-rate",
  evaluate(context) {
    if (!getPhase(context.phase).zone2Required) return null;
    if (context.plannedZone == null || context.plannedZone <= 2) return null;
    return {
      constraintId: "zone2-hr-ceiling",
      severity: "hard",
      message: `Planned Zone ${context.plannedZone} exceeds the Zone 2 ceiling for the ${context.phase} base phase (keep HR ≤ ${ZONE2_CEILING_BPM} bpm).`,
      suggestion:
        "Drop to an easy Zone 2 effort, or move the quality work to the sharpen/peak block.",
    };
  },
};

/** Restitution — at least 48 h between runs. */
const recovery48h: Constraint = {
  id: "recovery-48h",
  description: `At least ${MIN_RECOVERY_HOURS} h between runs.`,
  severity: "hard",
  category: "recovery",
  evaluate(context) {
    if (context.lastRunDate == null) return null;
    const gap = hoursBetween(context.plannedDate, context.lastRunDate);
    if (gap >= MIN_RECOVERY_HOURS) return null;
    return {
      constraintId: "recovery-48h",
      severity: "hard",
      message: `Only ${Math.round(gap)} h since the last run — below the ${MIN_RECOVERY_HOURS} h recovery minimum.`,
      suggestion: "Push this run back so at least 48 h have passed.",
    };
  },
};

/** Skadesforebyggelse — never squat / leg-press on a run day. */
const noStrengthOnRunDays: Constraint = {
  id: "no-strength-on-run-days",
  description: "Never squat / leg-press on a run day.",
  severity: "hard",
  category: "injury-prevention",
  evaluate(context) {
    if (!context.includesStrength) return null;
    if (!isRunDay(context)) return null;
    return {
      constraintId: "no-strength-on-run-days",
      severity: "hard",
      message: "Leg strength (squats / leg press) is scheduled on a run day.",
      suggestion: "Move heavy leg work to a rest day to protect the run.",
    };
  },
};

/** Sko — the Adios Pro 4 is for speed / intervals only. */
const adiosProSpeedOnly: Constraint = {
  id: "adios-pro-speed-only",
  description: "Adios Pro 4 only for speed / interval sessions.",
  severity: "hard",
  category: "footwear",
  evaluate(context) {
    if (!isAdiosPro(context.shoeType)) return null;
    if (context.plannedType == null) return null; // type unknown — stay graceful
    if (isSpeedSession(context.plannedType)) return null;
    return {
      constraintId: "adios-pro-speed-only",
      severity: "hard",
      message: `Adios Pro 4 is a race/speed shoe — not for a ${context.plannedType} run.`,
      suggestion: "Wear the Vomero (or another trainer) for easy and long days.",
    };
  },
};

/**
 * Lang tur — distance cap on long runs (16 km adapt/burn, 18 km sharpen/peak).
 *
 * The cap value is phase-derived, but business-logic §9 makes an over-distance
 * long run a HARD fail (it blocks), so the severity is "hard" rather than the
 * table's looser "phase" grouping — this is what routes it into `issues[]`.
 */
const longRunCap: Constraint = {
  id: "long-run-cap",
  description: "Long run capped at 16 km (adapt/burn) / 18 km (sharpen/peak).",
  severity: "hard",
  category: "long-run",
  evaluate(context) {
    if (context.plannedType !== "long") return null;
    if (context.plannedDistanceKm == null) return null;
    const cap = getPhase(context.phase).longRunMaxKm;
    if (context.plannedDistanceKm <= cap) return null;
    return {
      constraintId: "long-run-cap",
      severity: "hard",
      message: `Long run of ${context.plannedDistanceKm} km exceeds the ${cap} km cap for the ${context.phase} phase.`,
      suggestion: `Trim the long run to ${cap} km or less.`,
    };
  },
};

/** Fodbold — no hard running the day after a match. */
const footballRecovery: Constraint = {
  id: "football-recovery",
  description: "No hard running the day after a football match.",
  severity: "soft",
  category: "football",
  evaluate(context) {
    if (!context.footballYesterday) return null;
    if (!isQualityEffort(context)) return null;
    return {
      constraintId: "football-recovery",
      severity: "soft",
      message: "Hard session planned the day after football — legs are likely pre-fatigued.",
      suggestion: "Keep it easy (Zone 2) today, or shift the quality work by a day.",
    };
  },
};

/** Søvn — poor sleep raises HR and warrants an easier pace. */
const poorSleep: Constraint = {
  id: "sleep-hr-adjustment",
  description: "Poor sleep raises HR 3–5 bpm — ease the pace.",
  severity: "soft",
  category: "sleep",
  evaluate(context) {
    if (context.sleepQuality !== "poor") return null;
    return {
      constraintId: "sleep-hr-adjustment",
      severity: "soft",
      message: `Poor sleep — expect HR ~${POOR_SLEEP_HR_BUMP_BPM} bpm higher; treat it as a softer day.`,
      suggestion: `Ease the pace by ${POOR_SLEEP_PACE_ADJUSTMENT} and judge effort by feel.`,
    };
  },
};

/** Basefase — keep ~90% of running in Zone 2 during the adapt/burn base. */
const basePhaseZone2: Constraint = {
  id: "base-phase-zone2",
  description: "Base phases want ~90% of running in Zone 2 (adapt/burn only).",
  severity: "phase",
  category: "base-phase",
  evaluate(context) {
    if (!getPhase(context.phase).zone2Required) return null;
    if (!isSpeedSession(context.plannedType)) return null;
    return {
      constraintId: "base-phase-zone2",
      severity: "phase",
      message: `A ${context.plannedType} session sits outside the Zone 2 base the ${context.phase} phase is building.`,
      suggestion: "Save quality work for the sharpen phase; keep the base aerobic.",
    };
  },
};

/** Distance-øgning — weekly volume should grow no more than 10%. */
const weeklyProgression: Constraint = {
  id: "weekly-distance-progression",
  description: "Weekly distance should grow no more than 10%.",
  severity: "safety",
  category: "progression",
  evaluate(context) {
    const { weeklyDistanceKm, previousWeekDistanceKm } = context;
    if (weeklyDistanceKm == null || previousWeekDistanceKm == null || previousWeekDistanceKm <= 0) {
      return null;
    }
    if (weeklyDistanceKm <= previousWeekDistanceKm * MAX_WEEKLY_INCREASE_RATIO) return null;
    const pct = Math.round((weeklyDistanceKm / previousWeekDistanceKm - 1) * 100);
    return {
      constraintId: "weekly-distance-progression",
      severity: "safety",
      message: `Weekly volume is up ${pct}% (${previousWeekDistanceKm} → ${weeklyDistanceKm} km) — over the 10% safe limit.`,
      suggestion: `Cap this week near ${Math.round(previousWeekDistanceKm * MAX_WEEKLY_INCREASE_RATIO)} km.`,
    };
  },
};

/** Every constraint, in evaluation order. */
export const ALL_CONSTRAINTS: Constraint[] = [
  zone2HrCeiling,
  recovery48h,
  noStrengthOnRunDays,
  adiosProSpeedOnly,
  longRunCap,
  footballRecovery,
  poorSleep,
  basePhaseZone2,
  weeklyProgression,
];

/** Constraints that only apply while a base phase requires Zone 2. */
const ZONE2_ONLY_CONSTRAINTS = new Set(["zone2-hr-ceiling", "base-phase-zone2"]);

/** The constraints in force for a phase (drops the Zone-2 base rules outside adapt/burn). */
export function getActiveConstraints(phase: PhaseKey): Constraint[] {
  const zone2Required = getPhase(phase).zone2Required;
  return ALL_CONSTRAINTS.filter((c) => (ZONE2_ONLY_CONSTRAINTS.has(c.id) ? zone2Required : true));
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Run every active constraint against the context. Hard violations land in
 * `issues` (and flip `valid` false); soft / phase / safety violations land in
 * `warnings` (advisory only). Poor sleep additionally populates the HR and pace
 * adjustment hints.
 */
export function validateWorkout(context: WorkoutContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  for (const constraint of getActiveConstraints(context.phase)) {
    const issue = constraint.evaluate(context);
    if (!issue) continue;
    if (issue.severity === "hard") issues.push(issue);
    else warnings.push(issue);
  }

  const result: ValidationResult = {
    valid: issues.length === 0,
    issues,
    warnings,
  };

  if (context.sleepQuality === "poor") {
    result.hrAdjustmentBpm = POOR_SLEEP_HR_BUMP_BPM;
    result.paceAdjustment = POOR_SLEEP_PACE_ADJUSTMENT;
  }

  return result;
}
