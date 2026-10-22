// Stride — "Hvis du i stedet" (issue #342): what the *other* session types would
// have meant today, and what the engine itself says about them.
//
// The coach card answers one question — today's session, with the rule trace that
// explains it (#301). This module answers the follow-up the runner actually has
// ("roligt, tempo eller langtur?"): for every type today's pas is not, what the
// pass would have looked like, and whether the engine would have allowed it.
//
// The engine judges, never this module: every line runs the same
// `validateWorkout` the recommender runs, over a context built from the same
// workout input — so a verdict here is the engine's own verdict, and no recovery
// time is invented. Distance and zone are read, not made up: they come from the
// phase rules (`getPhaseRules`) and the recommender's own pace table
// (`PACE_RANGES`), so a type whose distance is only a band is shown as a band.
//
// Pure and deterministic: the clock is a parameter, so the same input always
// yields the same list.

import {
  ALL_CONSTRAINTS,
  getCurrentPhase,
  getLocalDate,
  getPhaseRules,
  type PhaseRules,
  validateWorkout,
  type WorkoutContext,
} from "@/lib/coach/engine";
import { PACE_RANGES, type RecommendedType, type WorkoutInput } from "@/lib/coach/recommender";

/** The run types the alternatives can name — the plan's own easy/tempo/long. */
export type AlternativeType = "easy" | "tempo" | "long";

/** The engine's verdict for one type today. */
export type AlternativeStatus = "allowed" | "warning" | "blocked";

/**
 * One rule's verdict, carried as the engine wrote it. `suggestion` is the
 * engine's own remedy — null when the rule raised no issue to remedy.
 */
export interface AlternativeVerdict {
  /** The rule's own id ("recovery-window"). */
  id: string;
  /** The rule's own Danish label ("Restitution"). */
  label: string;
  /** The engine's own message. */
  message: string;
  /** The engine's own remedy, or null. */
  suggestion: string | null;
}

/**
 * The distance the phase prescribes for a type, as a band. A band with one
 * value means the engine pins that distance exactly (the long run); a wider band
 * means the phase allows a range (the regular session band).
 */
export interface AlternativeDistance {
  minKm: number;
  maxKm: number;
}

/** One "what if you did X instead" line: the prescription and the engine's verdict. */
export interface WorkoutAlternative {
  type: AlternativeType;
  /** The type's Danish name, as the "Næste pas" card names it. */
  label: string;
  /** The phase's distance band for this type. */
  distance: AlternativeDistance;
  /** The target zone the recommender paces this type at. */
  zone: number;
  /** The target pace band, from the recommender's own table. */
  paceRange: { min: string; max: string };
  /** The engine's verdict: a hard issue blocks, a soft one warns. */
  status: AlternativeStatus;
  /** The engine's hard issues — the ones that block. */
  issues: AlternativeVerdict[];
  /** The engine's soft/phase/safety warnings — advisory only. */
  warnings: AlternativeVerdict[];
}

/**
 * One type's prescription — the recommender's own name, zone and shoe for it.
 * The three sit together so a type can never be named one way and paced
 * another.
 */
interface AlternativeSpec {
  type: AlternativeType;
  /** The type's Danish name, as the "Næste pas" card names it. */
  label: string;
  /** The target zone the recommender paces this type at. */
  zone: number;
  /** The shoe the recommender runs this type in. */
  shoe: "vomero" | "adios-pro-4";
}

/** The three types, in the plan's own order (easy / tempo / long). */
const TYPE_SPECS: AlternativeSpec[] = [
  { type: "easy", label: "Rolig tur", zone: 2, shoe: "vomero" },
  { type: "tempo", label: "Tempo", zone: 4, shoe: "adios-pro-4" },
  { type: "long", label: "Lang tur", zone: 2, shoe: "vomero" },
];

/**
 * The distance band the phase prescribes for a type. The long run is pinned to
 * the phase's long-run ceiling — the engine prescribes it exactly there, both in
 * the week plan and in the recommender — so it is one number. Every other
 * session sits in the phase's regular-session band, the same min–max the
 * recommender's own distance line quotes.
 */
function distanceBand(type: AlternativeType, rules: PhaseRules): AlternativeDistance {
  if (type === "long") {
    return { minKm: rules.longRunMaxKm, maxKm: rules.longRunMaxKm };
  }
  return { minKm: rules.minDistanceKm, maxKm: rules.maxDistanceKm };
}

/**
 * The engine's own Danish label per rule id — the same labels the rule-trace
 * card prints, so a line here names its rule the way the trace names it.
 */
const RULE_LABELS = new Map(ALL_CONSTRAINTS.map((constraint) => [constraint.id, constraint.label]));

/** The engine's own verdict for one context, as `validateWorkout` returns it. */
type EngineValidation = ReturnType<typeof validateWorkout>;

/**
 * The engine's own severity decides the status: a hard issue blocks, anything
 * softer only warns.
 */
function statusOf(validation: EngineValidation): AlternativeStatus {
  if (validation.issues.length > 0) return "blocked";
  if (validation.warnings.length > 0) return "warning";
  return "allowed";
}

/** The engine's own issue, as the verdict shape the surface renders. */
function toVerdict(issue: {
  constraintId: string;
  message: string;
  suggestion?: string;
}): AlternativeVerdict {
  return {
    id: issue.constraintId,
    label: RULE_LABELS.get(issue.constraintId) ?? issue.constraintId,
    message: issue.message,
    suggestion: issue.suggestion ?? null,
  };
}

/**
 * The alternatives to today's pas: every other run type, what it would have
 * meant, and the engine's own verdict on it right now.
 *
 * `todayType` is the type the recommender landed on — the alternative list never
 * repeats the pas the card already shows. A hviledag repeats nothing, so all
 * three types are listed.
 */
export function buildWorkoutAlternatives(
  input: WorkoutInput,
  now: Date,
  todayType: RecommendedType
): WorkoutAlternative[] {
  // The athlete's Danish calendar day decides the phase — the same rule the
  // recommender follows, so both read one phase.
  const today = getLocalDate(now);
  const phase = getCurrentPhase(today, input.raceDate);
  const rules = getPhaseRules(phase, input.raceDate);

  return TYPE_SPECS.filter((spec) => spec.type !== todayType).map((spec) => {
    const distance = distanceBand(spec.type, rules);
    // The context the engine judges: the recommender's own context with this
    // type's prescription swapped in, so the verdict is the engine's verdict for
    // that pas and nothing else.
    const context: WorkoutContext = {
      plannedDate: now,
      plannedType: spec.type,
      plannedDistanceKm: distance.maxKm,
      plannedZone: spec.zone,
      shoeType: spec.shoe,
      lastRunDate: input.lastRun,
      lastRunDistanceKm: input.lastRunSummary?.distanceKm,
      footballYesterday: input.footballYesterday,
      phase,
      risk: input.risk,
      raceDate: input.raceDate,
    };
    const validation = validateWorkout(context);

    return {
      type: spec.type,
      label: spec.label,
      distance,
      zone: spec.zone,
      paceRange: PACE_RANGES[spec.type],
      status: statusOf(validation),
      issues: validation.issues.map(toVerdict),
      warnings: validation.warnings.map(toVerdict),
    };
  });
}
