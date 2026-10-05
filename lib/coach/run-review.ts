// Stride — the per-run review context (issue #298). Reads the engine's plan
// facts server-side and flattens them to plain JSON for the analyze endpoint, so
// the deterministic run review can speak about the phase, the race, readiness,
// the recovery window and the week's three suggestions — without the route ever
// touching the database. Pure: the clock is a parameter.

import type { RunReviewPlanContext } from "@/lib/ai/analysis";
import { DEFAULT_RACE_DATE, DEFAULT_RACE_NAME } from "@/lib/coach/engine";
import type { WorkoutRecommendation } from "@/lib/coach/recommender";
import { getPlanSuggestions } from "@/lib/cobalt/plan";
import { readinessFromRatio } from "@/lib/cobalt/readiness";
import { ensureDate } from "@/lib/db/calendar-date";
import type { PredictionActivity } from "@/lib/training/prediction";

const DAY_MS = 86_400_000;

/** The activity fields the review context reads — DB rows and fixtures both fit. */
export interface RunReviewActivityInput {
  type: string;
  distance: number;
  movingTime: number;
  averageHeartrate?: number | null;
  startDate: Date | string;
}

/** Whole calendar days from `from` to `to` (local midnights, DST safe). */
function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / DAY_MS);
}

/** The newest run at or before `now` with usable distance/time, or null. */
function latestRun(activities: RunReviewActivityInput[], now: Date): RunReviewActivityInput | null {
  return activities
    .filter((a) => /run/i.test(a.type))
    .filter((a) => a.distance > 0 && a.movingTime > 0)
    .filter((a) => ensureDate(a.startDate).getTime() <= now.getTime())
    .reduce<RunReviewActivityInput | null>((latest, run) => {
      if (!latest) return run;
      return ensureDate(run.startDate).getTime() > ensureDate(latest.startDate).getTime()
        ? run
        : latest;
    }, null);
}

/**
 * Build the review context from the runner's activities and the engine's own
 * decision. `workout` must be the `recommendWorkout` result the coach page
 * already computed, so the review's recommendation can never contradict the
 * "Næste pas" card. `ratio` is the dashboard's acute:chronic ratio.
 */
export function buildRunReviewContext({
  activities,
  now,
  raceDate,
  raceName,
  raceDistanceKm,
  goalTimeSeconds,
  ratio,
  workout,
}: {
  activities: RunReviewActivityInput[];
  now: Date;
  raceDate?: Date;
  raceName?: string | null;
  raceDistanceKm?: number | null;
  goalTimeSeconds?: number | null;
  ratio: number | null;
  workout: WorkoutRecommendation;
}): RunReviewPlanContext {
  const effectiveRaceDate = raceDate ?? DEFAULT_RACE_DATE;
  const effectiveRaceName = raceName ?? DEFAULT_RACE_NAME;
  const predictionActivities: PredictionActivity[] = activities.map((a) => ({
    type: a.type,
    distance: a.distance,
    movingTime: a.movingTime,
    averageHeartrate: a.averageHeartrate ?? null,
    startDate: ensureDate(a.startDate),
  }));
  const plan = getPlanSuggestions(
    predictionActivities,
    now,
    effectiveRaceDate,
    effectiveRaceName,
    raceDistanceKm,
    undefined,
    goalTimeSeconds
  );
  const run = latestRun(activities, now);
  const readiness = readinessFromRatio(ratio);

  return {
    phase: plan.phase,
    phaseLabel: plan.phaseLabel,
    raceLabel: effectiveRaceName,
    daysToRace: daysBetween(now, effectiveRaceDate),
    readiness: { pct: readiness.pct, band: readiness.band, note: readiness.note },
    // The exact window the recommender enforced before the run it landed on —
    // carried on the recommendation, so an injury's 72 hours are quoted as such
    // instead of being re-derived (wrongly) from the final workout type.
    recoveryHours: workout.recoveryHours,
    suggestions: plan.suggestions,
    lastRun: run
      ? {
          startDate: ensureDate(run.startDate),
          distanceKm: Math.round((run.distance / 1000) * 10) / 10,
          paceSecPerKm: Math.round((run.movingTime / run.distance) * 1000),
          averageHeartrate: run.averageHeartrate ?? null,
          movingTimeSec: run.movingTime,
        }
      : null,
    recommended: {
      type: workout.type,
      distanceKm: workout.distanceKm,
      reason: workout.reason[0] ?? "",
    },
  };
}
