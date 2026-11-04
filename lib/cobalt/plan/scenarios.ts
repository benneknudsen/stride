// Cobalt Glass — Plan scenarios.
//
// The "hvad hvis" card: the same race predictor pointed at each of the four
// standard distances, with each distance's own lock when it has no projection.

import { formatDistanceKm, raceDistanceLabel } from "@/lib/cobalt/format";
import { LOW_CONFIDENCE_PACE_SPREAD, PACE_RANGE_SPREAD } from "@/lib/cobalt/plan/prescription";
import { lockFrom, type RaceLock } from "@/lib/cobalt/plan/upcoming";
import { formatRaceTime as formatClock } from "@/lib/cobalt/race-estimate";
import {
  formatPaceRange,
  HALF_MARATHON_KM,
  type PredictionActivity,
  predictRace,
  type RacePrediction,
} from "@/lib/training/prediction";

/**
 * How much a scenario's projection is worth — the predictor's own scale, named
 * here so the view-model never re-derives it (issue #340).
 */
export type ScenarioConfidence = RacePrediction["confidence"];

/** The confidence in the card's own words — the "Sikkerhed" line. */
const CONFIDENCE_LABELS: Record<ScenarioConfidence, string> = {
  high: "Høj",
  medium: "Middel",
  low: "Lav",
};

/**
 * One distance the "hvad hvis" card explores (issue #340): what the runner's
 * *current* basis reaches at that distance, the pace it corresponds to, and the
 * lock that keeps the distance from having an answer at all.
 *
 * Every number here is the predictor's own — the card asks what today's data
 * reaches, never what training would make of it. A distance the predictor can't
 * reach carries its own lock (the predictor's message, written for *that*
 * distance) and no number, so no distance ever borrows another's answer.
 */
export interface RaceScenario {
  /** The distance in km. */
  distanceKm: number;
  /** The distance as a name ("5K", "Halvmarathon"). */
  label: string;
  /** The distance as a figure ("5 km", "21,1 km"). */
  distanceKmLabel: string;
  /** True when this is the distance the runner registered for. */
  isOwnRace: boolean;
  /** The predicted finish time in seconds — null when the distance is locked. */
  timeSeconds: number | null;
  /** The prediction as a clock ("1:38") — null when locked. */
  estimate: string | null;
  /** The prediction's race pace in seconds/km — null when locked. */
  paceSecPerKm: number | null;
  /**
   * The pace as a range ("4:30–4:50"), widened under low confidence (issue
   * #231) — a projection resting on one run must not read as precise. Null when
   * the distance is locked.
   */
  paceRange: string | null;
  /** How much the projection is worth — null when locked. */
  confidence: ScenarioConfidence | null;
  /** The confidence in Danish ("Lav") — null when locked. */
  confidenceLabel: string | null;
  /**
   * The goal the card opens with, in seconds: the runner's own goal when this is
   * their race distance, else the round goal just above the projection — the same
   * goal the race card shows. Null when the distance is locked.
   */
  defaultGoalSeconds: number | null;
  /** Why this distance has no projection (issue #117) — null when it has one. */
  lock: RaceLock | null;
}

/** The four distances the "hvad hvis" card explores (issue #340). */
const SCENARIO_DISTANCES_KM = [5, 10, HALF_MARATHON_KM, 42.195];

/** How close two distances must be to count as the same race. */
const SCENARIO_DISTANCE_TOLERANCE_KM = 0.05;

/** The step a goal is rounded up to — `goalTimeFor`'s own step, in minutes. */
const GOAL_STEP_MINUTES = 5;

/**
 * A committable goal for a projection: the round number just above it, in
 * seconds. `goalTimeFor` prints this rule as a clock; the what-if card needs it
 * as a number, because the runner adjusts it.
 */
function goalSecondsFor(seconds: number): number {
  const step = GOAL_STEP_MINUTES * 60;
  return Math.ceil(seconds / step) * step;
}

/**
 * The "hvad hvis" scenarios (issue #340): the same predictor, pointed at each of
 * the four standard distances. Nothing new is modelled here — the projection for
 * a distance is `predictRace`'s projection for that distance, so the card can
 * only ever say what the runner's data reaches today.
 *
 * A distance the predictor can't reach carries that distance's own lock — the
 * predictor's message, written against the run that would unlock *it* — and no
 * number at all, so a locked distance never shows another distance's answer.
 *
 * The caller hands over every activity it has: `predictRace` picks the runs it
 * can anchor on, so nothing here has to know what counts as a run.
 */
export function buildScenarios(
  activities: PredictionActivity[],
  now: Date,
  hrMaxOverride: number | null | undefined,
  raceDistanceKm: number | null | undefined,
  goalTimeSeconds: number | null | undefined
): RaceScenario[] {
  return SCENARIO_DISTANCES_KM.map((km) => {
    const names = raceDistanceLabel(km);
    const isOwnRace =
      raceDistanceKm != null && Math.abs(raceDistanceKm - km) <= SCENARIO_DISTANCE_TOLERANCE_KM;
    const result = predictRace(activities, now, km, hrMaxOverride);
    const prediction = result.prediction;
    const base = {
      distanceKm: km,
      label: names.label,
      distanceKmLabel: formatDistanceKm(km),
      isOwnRace,
    };

    if (!prediction) {
      return {
        ...base,
        timeSeconds: null,
        estimate: null,
        paceSecPerKm: null,
        paceRange: null,
        confidence: null,
        confidenceLabel: null,
        defaultGoalSeconds: null,
        lock: lockFrom(result),
      };
    }

    const spread = prediction.confidence === "low" ? LOW_CONFIDENCE_PACE_SPREAD : PACE_RANGE_SPREAD;
    return {
      ...base,
      timeSeconds: prediction.timeSeconds,
      estimate: formatClock(prediction.timeSeconds),
      paceSecPerKm: prediction.paceSecPerKm,
      paceRange: formatPaceRange(prediction.paceSecPerKm, spread),
      confidence: prediction.confidence,
      confidenceLabel: CONFIDENCE_LABELS[prediction.confidence],
      // The runner's own goal on their own distance; anywhere else the round
      // goal just above the projection — the same goal the race card shows.
      defaultGoalSeconds:
        isOwnRace && goalTimeSeconds != null && goalTimeSeconds > 0
          ? goalTimeSeconds
          : goalSecondsFor(prediction.timeSeconds),
      lock: null,
    };
  });
}
