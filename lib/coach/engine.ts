// Stride — coach rule engine. The single source of truth for the periodised
// build toward the user's target race and the constraint set the coach must
// respect when it proposes or validates a workout.
//
// Four modules, re-exported here:
//   1. Types — the shared vocabulary: session types, phase rules, the
//      constraint/trace shapes and the tunable limits.
//   2. Phases — four training blocks (adapt → burn → sharpen → peak) laid out
//      relative to the race date (issue #99: the date lives per user in the
//      DB; `buildPhases(raceDate)` dates the blocks for any race), each with
//      its own session volume, Zone-2 requirement and distance caps.
//   3. Week plan — `getWeekPlan` turns a phase into a Mon–Sun session layout.
//   4. Constraints — independent, self-guarding rules (hard blocks, soft
//      warnings, phase guidance, safety limits) evaluated against a single
//      WorkoutContext. `validateWorkout` runs the active set and sorts the
//      results into blocking issues vs. non-blocking warnings.
//
// Everything here is pure and deterministic — the only clock reads are the
// default arguments of `getLocalDate`/`getCurrentPhase` — which keeps it
// trivially testable and safe to call from server actions or the coach surface.

export {
  ALL_CONSTRAINTS,
  getActiveConstraints,
  traceWorkout,
  validateWorkout,
} from "./constraints";

export {
  buildPhases,
  getCurrentPhase,
  getLocalDate,
  getPhaseRules,
  planTotalWeeks,
} from "./phase";
export type {
  ConstraintTrace,
  ConstraintTraceStatus,
  PhaseKey,
  PhaseRules,
  PlannedSession,
  SessionRisk,
  SessionType,
  Severity,
  WorkoutContext,
} from "./types";
export {
  DEFAULT_RACE_DATE,
  DEFAULT_RACE_NAME,
  EASY_MIN_RECOVERY_HOURS,
  HALF_MARATHON_KM,
  MAX_WEEKLY_INCREASE_RATIO,
  MIN_RECOVERY_HOURS,
  WEEKDAYS,
  ZONE2_CEILING_BPM,
} from "./types";
export { type SerializedValidationResult, serializeValidationResult } from "./validation-result";
export { getWeekPlan } from "./week-plan";
