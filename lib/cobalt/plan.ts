// Cobalt Glass — Plan view-model.
//
// Stable entry point for the plan. The calculation layers live under
// `lib/cobalt/plan/`: prescriptions, upcoming weeks, scenarios and the view
// model. Consumers keep importing from `@/lib/cobalt/plan`.

export type { RunSuggestion, SessionTone, SuggestionType } from "@/lib/cobalt/plan/prescription";
export type { RaceScenario, ScenarioConfidence } from "@/lib/cobalt/plan/scenarios";
export type {
  DerivedPlan,
  DerivedPlanResult,
  RaceLock,
  UpcomingSession,
  UpcomingWeek,
} from "@/lib/cobalt/plan/upcoming";
export { buildDerivedPlan } from "@/lib/cobalt/plan/upcoming";
export type { PhaseMarker, PhaseSegment, PlanView } from "@/lib/cobalt/plan/view";
export { buildPlanView, getPlanSuggestions } from "@/lib/cobalt/plan/view";
