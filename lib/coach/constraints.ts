import { getPhaseRules } from "./phase";
import {
  type Constraint,
  type ConstraintTrace,
  EASY_MIN_RECOVERY_HOURS,
  MAX_WEEKLY_INCREASE_RATIO,
  MIN_RECOVERY_HOURS,
  type PhaseKey,
  type ValidationIssue,
  type ValidationResult,
  type WorkoutContext,
  ZONE2_CEILING_BPM,
} from "./types";

// ── Constraint helpers ──────────────────────────────────────────────────────

/** Session types that count as fast/quality work (Adios Pro 4 territory). */
const SPEED_SESSION_TYPES = new Set(["tempo", "intervals", "race", "fartlek", "speed"]);

/** Session types that are NOT a run — leg strength on these days is fine. */
const NON_RUN_TYPES = new Set(["rest", "strength", "cross", "off", "mobility", "yoga"]);

/** Lowercased, trimmed session type — callers (form input, UI) vary the casing. */
function normalizeType(type?: string): string | undefined {
  return type?.trim().toLowerCase() || undefined;
}

function isSpeedSession(type?: string): boolean {
  const normalized = normalizeType(type);
  return normalized != null && SPEED_SESSION_TYPES.has(normalized);
}

/** A hard effort either by session type (speed work) or by target zone (≥ Z3). */
function isQualityEffort(context: WorkoutContext): boolean {
  return (
    isSpeedSession(context.plannedType) || (context.plannedZone != null && context.plannedZone >= 3)
  );
}

/** Whether the day carries a run (so leg strength would clash with it). */
function isRunDay(context: WorkoutContext): boolean {
  const normalized = normalizeType(context.plannedType);
  if (normalized != null) return !NON_RUN_TYPES.has(normalized);
  return context.plannedDistanceKm != null && context.plannedDistanceKm > 0;
}

/** The Adidas Adios Pro 4 — a carbon race shoe, identified loosely by name. */
function isAdiosPro(shoe?: string): boolean {
  return shoe?.toLowerCase().includes("adios") ?? false;
}

// Klemmes til ≥ 0: et ur foran serverens UTC må aldrig give et negativt gap.
function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (a.getTime() - b.getTime()) / 3_600_000);
}

// ── Constraints ─────────────────────────────────────────────────────────────

/** Puls — Zone 2 ceiling. Base phases must not exceed Zone 2. */
const zone2HrCeiling: Constraint = {
  id: "zone2-hr-ceiling",
  label: "Zone 2-loft",
  description: `Basefaser holder indsatsen på maks Zone 2 (≤ ${ZONE2_CEILING_BPM} bpm, absolut — ikke %HRmax).`,
  severity: "hard",
  category: "heart-rate",
  evaluate(context) {
    if (!getPhaseRules(context.phase, context.raceDate).zone2Required) return null;
    if (context.plannedZone == null || context.plannedZone <= 2) return null;
    return {
      constraintId: "zone2-hr-ceiling",
      severity: "hard",
      message: `Planlagt Zone ${context.plannedZone} overskrider Zone 2-loftet for ${context.phase}-basefasen (hold pulsen ≤ ${ZONE2_CEILING_BPM} bpm).`,
      suggestion:
        "Gå ned til en rolig Zone 2-indsats, eller flyt kvalitetsarbejdet til sharpen/peak-blokken.",
    };
  },
};

/**
 * Restitution — a recovery window before every run: 48 h before quality work,
 * 24 h before easy/long runs (a flat 48 h would outlaw the 5-session weeks).
 */
const recoveryWindow: Constraint = {
  id: "recovery-window",
  label: "Restitution",
  description: `Mindst ${MIN_RECOVERY_HOURS} timer før kvalitetspas, ${EASY_MIN_RECOVERY_HOURS} timer før rolige ture.`,
  severity: "hard",
  category: "recovery",
  evaluate(context) {
    if (context.lastRunDate == null) return null;
    if (!isRunDay(context)) return null;
    const required = isQualityEffort(context) ? MIN_RECOVERY_HOURS : EASY_MIN_RECOVERY_HOURS;
    const gap = hoursBetween(context.plannedDate, context.lastRunDate);
    if (gap >= required) return null;
    return {
      constraintId: "recovery-window",
      severity: "hard",
      message: `For kort tid siden hårdt pas — kun ${Math.round(gap)} timer siden sidste løbetur, under minimumet på ${required} timers restitution for dette pas.`,
      suggestion: `Udskyd turen, så der er gået mindst ${required} timer — planlæg hviledag eller let løb.`,
    };
  },
};

/** Skadesforebyggelse — never squat / leg-press on a run day. */
const noStrengthOnRunDays: Constraint = {
  id: "no-strength-on-run-days",
  label: "Styrke på løbedag",
  description: "Aldrig squat / benpres på en løbedag.",
  severity: "hard",
  category: "injury-prevention",
  evaluate(context) {
    if (!context.includesStrength) return null;
    if (!isRunDay(context)) return null;
    return {
      constraintId: "no-strength-on-run-days",
      severity: "hard",
      message: "Benstyrke (squat / benpres) er planlagt på en løbedag.",
      suggestion: "Flyt tung bentræning til en hviledag for at beskytte løbeturen.",
    };
  },
};

/** Sko — the Adios Pro 4 is for speed / intervals only. */
const adiosProSpeedOnly: Constraint = {
  id: "adios-pro-speed-only",
  label: "Sko til fart",
  description: "Adios Pro 4 kun til fart- / intervalpas.",
  severity: "hard",
  category: "footwear",
  evaluate(context) {
    if (!isAdiosPro(context.shoeType)) return null;
    if (context.plannedType == null) return null; // type unknown — stay graceful
    if (isSpeedSession(context.plannedType)) return null;
    return {
      constraintId: "adios-pro-speed-only",
      severity: "hard",
      message: `Adios Pro 4 er en konkurrence-/fartsko — ikke til en ${context.plannedType}-tur.`,
      suggestion: "Brug andre sko — Vomero (eller en anden træningssko) til rolige og lange dage.",
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
  label: "Loft på lang tur",
  description: "Lang tur begrænset til 16 km (adapt/burn) / 18 km (sharpen/peak).",
  severity: "hard",
  category: "long-run",
  evaluate(context) {
    if (normalizeType(context.plannedType) !== "long") return null;
    if (context.plannedDistanceKm == null) return null;
    const cap = getPhaseRules(context.phase, context.raceDate).longRunMaxKm;
    if (context.plannedDistanceKm <= cap) return null;
    return {
      constraintId: "long-run-cap",
      severity: "hard",
      message: `Lang tur på ${context.plannedDistanceKm} km overskrider loftet på ${cap} km for ${context.phase}-fasen.`,
      suggestion: `Kort den lange tur ned til ${cap} km eller mindre.`,
    };
  },
};

/** Fodbold — no hard running the day after a match. */
const footballRecovery: Constraint = {
  id: "football-recovery",
  label: "Fodbold i går",
  description: "Ingen hård løbetræning dagen efter en fodboldkamp.",
  severity: "soft",
  category: "football",
  evaluate(context) {
    if (!context.footballYesterday) return null;
    if (!isQualityEffort(context)) return null;
    return {
      constraintId: "football-recovery",
      severity: "soft",
      message: "Hårdt pas planlagt dagen efter fodbold — benene er sandsynligvis forbelastede.",
      suggestion: "Hold det roligt (Zone 2) i dag, eller flyt kvalitetsarbejdet en dag.",
    };
  },
};

/** Basefase — keep ~90% of running in Zone 2 during the adapt/burn base. */
const basePhaseZone2: Constraint = {
  id: "base-phase-zone2",
  label: "Zone 2-base",
  description: "Basefaser vil have ~90% af løbet i Zone 2 (kun adapt/burn).",
  severity: "phase",
  category: "base-phase",
  evaluate(context) {
    if (!getPhaseRules(context.phase, context.raceDate).zone2Required) return null;
    if (!isSpeedSession(context.plannedType)) return null;
    return {
      constraintId: "base-phase-zone2",
      severity: "phase",
      message: `Et ${context.plannedType}-pas ligger uden for den Zone 2-base, som ${context.phase}-fasen bygger.`,
      suggestion: "Gem kvalitetsarbejdet til sharpen-fasen; hold basen aerob.",
    };
  },
};

/** Distance-øgning — weekly volume should grow no more than 10%. */
const weeklyProgression: Constraint = {
  id: "weekly-distance-progression",
  label: "Ugentlig progression",
  description: "Ugentlig distance bør højst vokse 10%.",
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
      message: `Ugentlig volumen er steget ${pct}% (${previousWeekDistanceKm} → ${weeklyDistanceKm} km) — over den sikre grænse på 10%.`,
      suggestion: `Begræns denne uge til omkring ${Math.round(previousWeekDistanceKm * MAX_WEEKLY_INCREASE_RATIO)} km.`,
    };
  },
};

/**
 * Risiko — a session flagged high-risk by the caller should not also be a hard
 * effort. Soft (advisory): the recommender already downgrades on this signal,
 * but validating it here keeps the rule explicit and testable (issue #76 B2).
 */
const highRiskSession: Constraint = {
  id: "high-risk-session",
  label: "Højrisiko",
  description: "Et højrisiko-pas skal holdes roligt (ingen kvalitetsindsats).",
  severity: "soft",
  category: "risk",
  evaluate(context) {
    if (context.risk !== "high") return null;
    if (!isQualityEffort(context)) return null;
    return {
      constraintId: "high-risk-session",
      severity: "soft",
      message: "Hårdt pas planlagt på en session markeret som højrisiko.",
      suggestion: "Hold det roligt (Zone 2) i dag, eller udskyd kvalitetsarbejdet.",
    };
  },
};

/** Every constraint, in evaluation order. */
export const ALL_CONSTRAINTS: Constraint[] = [
  zone2HrCeiling,
  recoveryWindow,
  noStrengthOnRunDays,
  adiosProSpeedOnly,
  longRunCap,
  footballRecovery,
  basePhaseZone2,
  weeklyProgression,
  highRiskSession,
];

/** Constraints that only apply while a base phase requires Zone 2. */
const ZONE2_ONLY_CONSTRAINTS = new Set(["zone2-hr-ceiling", "base-phase-zone2"]);

/** The constraints in force for a phase (drops the Zone-2 base rules outside adapt/burn). */
export function getActiveConstraints(phase: PhaseKey): Constraint[] {
  const zone2Required = getPhaseRules(phase).zone2Required;
  return ALL_CONSTRAINTS.filter((c) => (ZONE2_ONLY_CONSTRAINTS.has(c.id) ? zone2Required : true));
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Run every active constraint against the context. Hard violations land in
 * `issues` (and flip `valid` false); soft / phase / safety violations land in
 * `warnings` (advisory only).
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

  return {
    valid: issues.length === 0,
    issues,
    warnings,
  };
}

// ── Constraint trace (#301) ─────────────────────────────────────────────────

/**
 * Trace every constraint against one context (issue #301): one row per entry in
 * {@link ALL_CONSTRAINTS}, in that order — including the rules that passed and
 * the phase-inactive ones, so the surface can show the whole rule set rather
 * than only what fired. Statuses mirror `validateWorkout` exactly: a `hard`
 * issue is `blocked`, anything else is `warning`, so the trace can never claim
 * a block the validator did not produce. Pure and deterministic.
 */
export function traceWorkout(context: WorkoutContext): ConstraintTrace[] {
  const activeIds = new Set(getActiveConstraints(context.phase).map((c) => c.id));

  return ALL_CONSTRAINTS.map((constraint) => {
    const base = {
      id: constraint.id,
      category: constraint.category,
      severity: constraint.severity,
      label: constraint.label,
    };

    if (!activeIds.has(constraint.id)) {
      return { ...base, status: "not-applicable", detail: constraint.description };
    }

    const issue = constraint.evaluate(context);
    if (!issue) {
      return { ...base, status: "passed", detail: constraint.description };
    }

    return {
      ...base,
      status: issue.severity === "hard" ? "blocked" : "warning",
      detail: issue.message,
      ...(issue.suggestion ? { suggestion: issue.suggestion } : {}),
    };
  });
}
