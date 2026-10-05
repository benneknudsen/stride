/**
 * Issue #298 — `buildRunReviewContext`: the server-side seam that reads the
 * engine's plan facts (phase, race, suggestions, the recommender's own decision)
 * plus the runner's latest run, and hands them to the analyze endpoint as plain
 * JSON. The review itself is built from this context, so the consistency pinned
 * here is the consistency the feed shows.
 */

import { describe, expect, it } from "vitest";
import { type AnalysisActivity, buildAnalysisInput, runReviewBlock } from "@/lib/ai/analysis";
import { DEFAULT_RACE_NAME, getCurrentPhase } from "@/lib/coach/engine";
import { recommendWorkout } from "@/lib/coach/recommender";
import { buildRunReviewContext } from "@/lib/coach/run-review";
import { GOALS } from "@/lib/training/goals";
import { computeSnapshot, type ProgressionActivityInput } from "@/lib/training/progression";

const NOW = new Date("2026-07-08T12:00:00.000Z");
const RACE_DATE = new Date(2026, 8, 20); // 20 Sep 2026 — engine demo race day
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 3_600_000;

/** Build a run `daysAgo` before `now` with the given km / pace (sec per km). */
function run(
  daysAgo: number,
  km: number,
  paceSecPerKm: number,
  hr: number,
  now: Date = NOW
): ProgressionActivityInput & AnalysisActivity {
  const distance = km * 1000;
  const movingTime = Math.round(km * paceSecPerKm);
  return {
    type: "Run",
    distance,
    movingTime,
    averageHeartrate: hr,
    hrZones: null,
    startDate: new Date(now.getTime() - daysAgo * DAY_MS),
  };
}

/** A settled 18-week base ending at `now` — reads "ready", not a warming-up ratio. */
function steadyAround(now: Date): (ProgressionActivityInput & AnalysisActivity)[] {
  return Array.from({ length: 18 }, (_, week) =>
    [1, 3, 5].map((day) => run(day + week * 7, 8, 312, 150, now))
  ).flat();
}

const STEADY = steadyAround(NOW);

function workoutFor(lastRun: Date) {
  return recommendWorkout(
    {
      userId: "u1",
      goal: GOALS.zone2,
      progression: computeSnapshot(STEADY, NOW),
      lastRun,
      footballYesterday: false,
      raceDate: RACE_DATE,
    },
    NOW
  );
}

function contextFor(lastRun: Date) {
  const workout = workoutFor(lastRun);
  const context = buildRunReviewContext({
    activities: STEADY,
    now: NOW,
    raceDate: RACE_DATE,
    raceName: "Testløbet",
    raceDistanceKm: 21.0975,
    goalTimeSeconds: null,
    ratio: computeSnapshot(STEADY, NOW).trainingLoad.ratio,
    workout,
  });
  return { workout, context };
}

describe("buildRunReviewContext", () => {
  it("carries the engine's phase, race, suggestions and latest run", () => {
    const newest = new Date(NOW.getTime() - DAY_MS);
    const { context } = contextFor(newest);

    expect(context.phase).toBe(getCurrentPhase(NOW, RACE_DATE));
    expect(context.phaseLabel).toBe("Burn");
    expect(context.raceLabel).toBe("Testløbet");
    expect(context.daysToRace).toBe(74);
    expect(context.suggestions).toHaveLength(3);
    expect(context.suggestions.map((s) => s.type)).toEqual(["easy", "tempo", "long"]);
    expect(context.lastRun).not.toBeNull();
    expect(context.lastRun?.paceSecPerKm).toBe(312);
    expect(context.lastRun?.distanceKm).toBe(8);
    expect(context.lastRun?.averageHeartrate).toBe(150);
  });

  it("falls back to the engine's demo race name when the user has none", () => {
    const workout = workoutFor(new Date(NOW.getTime() - DAY_MS));
    const context = buildRunReviewContext({
      activities: STEADY,
      now: NOW,
      raceDate: RACE_DATE,
      ratio: computeSnapshot(STEADY, NOW).trainingLoad.ratio,
      workout,
    });

    expect(context.raceLabel).toBe(DEFAULT_RACE_NAME);
  });

  it("mirrors the recommender's decision and its recovery window", () => {
    const { workout, context } = contextFor(new Date(NOW.getTime() - DAY_MS));

    expect(workout.type).toBe("easy");
    expect(context.recommended.type).toBe(workout.type);
    expect(context.recoveryHours).toBe(24);
    expect(context.recommended.reason).toBe(workout.reason[0]);
  });

  it("inside the recovery window the review excludes the forbidden run", () => {
    const recent = new Date(NOW.getTime() - 4 * HOUR_MS);
    const { workout, context } = contextFor(recent);

    expect(workout.type).toBe("rest");
    expect(context.recommended.type).toBe("rest");

    const input = buildAnalysisInput(STEADY, "trend", NOW, context);
    const review = runReviewBlock(input, NOW);

    expect(review).not.toBeNull();
    expect(review?.suggestedRun).toBeNull();
    expect(review?.nextRunLabel).toContain("hviledag");
  });

  it("outside the window the review points at the run the recommender landed on", () => {
    const { workout, context } = contextFor(new Date(NOW.getTime() - DAY_MS));

    const input = buildAnalysisInput(STEADY, "trend", NOW, context);
    const review = runReviewBlock(input, NOW);
    const chosen = context.suggestions.find((s) => s.type === workout.type);

    expect(workout.type).not.toBe("rest");
    expect(chosen).toBeDefined();
    expect(review?.suggestedRun).toContain(chosen?.label);
  });

  it("uses 48 hours as the window when the recommender prescribes tempo", () => {
    // Saturday of the sharpen phase: the week plan's tempo day is Wednesday, so
    // pick a date whose slot is tempo. The recommender only prescribes tempo in
    // sharpen/peak; 2026-08-12 (Wednesday) is inside sharpen (Aug 3 – Aug 23).
    const tempoNow = new Date("2026-08-12T12:00:00.000Z");
    const steady = steadyAround(tempoNow);
    const progression = computeSnapshot(steady, tempoNow);
    const workout = recommendWorkout(
      {
        userId: "u1",
        goal: GOALS.zone2,
        progression,
        lastRun: new Date(tempoNow.getTime() - 3 * DAY_MS),
        footballYesterday: false,
        raceDate: RACE_DATE,
      },
      tempoNow
    );
    const context = buildRunReviewContext({
      activities: steady,
      now: tempoNow,
      raceDate: RACE_DATE,
      ratio: progression.trainingLoad.ratio,
      workout,
    });

    expect(workout.type).toBe("tempo");
    expect(context.recoveryHours).toBe(48);
  });

  it("carries the 72-hour injury window when the recommender applied it", () => {
    const progression = computeSnapshot(STEADY, NOW);
    const workout = recommendWorkout(
      {
        userId: "u1",
        goal: GOALS.zone2,
        progression,
        lastRun: new Date(NOW.getTime() - 3 * DAY_MS),
        footballYesterday: false,
        injuryHistory: true,
        raceDate: RACE_DATE,
      },
      NOW
    );
    const context = buildRunReviewContext({
      activities: STEADY,
      now: NOW,
      raceDate: RACE_DATE,
      ratio: progression.trainingLoad.ratio,
      workout,
    });

    expect(workout.recoveryHours).toBe(72);
    expect(context.recoveryHours).toBe(72);
  });
});
