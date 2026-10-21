/**
 * Issue #298 — the per-run coach review.
 *
 * `runReviewBlock` turns the engine's plan context plus the runner's most recent
 * run into one typed `runReview` block: the run's own numbers, how it compares
 * to the last seven days, and which of the week's three suggestions is next
 * (according to `recommendWorkout`, whose decision the server puts in
 * `planContext.recommended`). Pure arithmetic over supplied inputs — the clock
 * is a parameter, so the tests pin it.
 */

import { describe, expect, it } from "vitest";
import {
  type AnalysisActivity,
  type AnalysisInput,
  buildAnalysisInput,
  heuristicBlocks,
  type RunReviewPlanContext,
  runReviewBlock,
} from "@/lib/ai/analysis";
import { analysisBlockSchema } from "@/lib/ai/tools";
import { getCurrentPhase } from "@/lib/coach/engine";
import { DA_WEEKDAYS, formatDanish } from "@/lib/cobalt/format";
import { formatDuration } from "@/lib/metrics";

const NOW = new Date("2026-07-08T12:00:00.000Z");
const LAST_START = new Date("2026-07-08T08:00:00.000Z");

/** A run with distance in km and pace in seconds per km. */
function activity(
  startDate: Date,
  km: number,
  paceSecPerKm: number,
  hr: number | null
): AnalysisActivity {
  const distance = km * 1000;
  const movingTime = Math.round(km * paceSecPerKm);
  return {
    startDate,
    distance,
    movingTime,
    averageSpeed: distance / movingTime,
    averageHeartrate: hr,
    totalElevationGain: 20,
  };
}

const LAST_RUN = activity(LAST_START, 10, 267, 165);
/** Same 10 km a week earlier: equal weekly volume, so the old feed stays flat. */
const PREVIOUS_WEEK_RUN = activity(new Date("2026-07-01T08:00:00.000Z"), 10, 267, 165);

/** The engine facts the server derives and sends along (issue #298). */
function context(overrides: Partial<RunReviewPlanContext> = {}): RunReviewPlanContext {
  return {
    phase: "burn",
    phaseLabel: "Burn",
    raceLabel: "Silkeborg Halvmarathon",
    daysToRace: 74,
    readiness: { pct: 85, band: "ready", note: "Klar til hårdt pas" },
    recoveryHours: 24,
    suggestions: [
      {
        type: "easy",
        label: "Let pas",
        description: "Rolig restitution",
        distanceKm: 9,
        paceRange: { min: "5:45", max: "6:15" },
      },
      {
        type: "tempo",
        label: "Kvalitetspas",
        description: "Tempo · hårdt",
        distanceKm: 10,
        paceRange: { min: "4:45", max: "5:05" },
      },
      {
        type: "long",
        label: "Langtur",
        description: "Lang tur · moderat",
        distanceKm: 16,
        paceRange: { min: "5:45", max: "6:15" },
      },
    ],
    lastRun: {
      startDate: LAST_START.toISOString(),
      distanceKm: 10,
      paceSecPerKm: 267,
      averageHeartrate: 165,
      movingTimeSec: 2670,
    },
    recommended: {
      type: "easy",
      distanceKm: 8,
      reason: "Distance fra burn-fasens bånd (8–10 km).",
    },
    ...overrides,
  };
}

function inputWith(
  planContext: RunReviewPlanContext | undefined,
  activities: AnalysisActivity[] = [LAST_RUN]
): AnalysisInput {
  return buildAnalysisInput(activities, "trend", NOW, planContext);
}

describe("runReviewBlock", () => {
  it("builds the review from the run's own pace, heart rate and distance", () => {
    const block = runReviewBlock(inputWith(context()), NOW);

    expect(block).not.toBeNull();
    expect(block?.tool).toBe("runReview");
    expect(block?.title).toBe(`${DA_WEEKDAYS[getLocalDateForTest(LAST_START)]}sturen · 10,0 km`);
    expect(block?.metric).toBe("4:27 /km · 165 bpm");
    expect(block?.body).toContain(formatDuration(2670));
    expect(block?.body).toContain("Burn-fasen");
    expect(block?.body).toContain("74 dage");
  });

  it("is deterministic — same input and clock give byte-identical output", () => {
    const input = inputWith(context());

    expect(JSON.stringify(runReviewBlock(input, NOW))).toBe(
      JSON.stringify(runReviewBlock(input, NOW))
    );
    expect(JSON.stringify(heuristicBlocks(input, NOW))).toBe(
      JSON.stringify(heuristicBlocks(input, NOW))
    );
  });

  it("takes the feed's workout suggestion from the engine when plan context exists (#333)", () => {
    // Repair R4: the feed used to re-derive today's session from the volume
    // trend alone. With a plan context the engine's decision is already known —
    // here a gate has made the day easy, so the feed must not prescribe tempo.
    const reason =
      "Din sidste tur var et hårdt pas — i dag bliver det en rolig tur, så benene har nået at restituere.";
    const ctx = context({
      recommended: { type: "easy", distanceKm: 8, reason },
    });
    const input = inputWith(ctx, [LAST_RUN, PREVIOUS_WEEK_RUN]);
    const workout = heuristicBlocks(input, NOW).find((b) => b.tool === "workoutRecommendation");

    expect(workout).toBeDefined();
    if (workout?.tool === "workoutRecommendation") {
      expect(workout.workoutType).toBe("Restitution");
      expect(workout.title).toBe("Rolig restitutions-tur");
      expect(workout.rationale).toBe(reason);
      expect(workout.distanceKm).toBe(8);
      expect(workout.workoutType).not.toBe("Tempo");
    }
  });

  it("keeps the volume-based suggestion when no plan context is supplied (#298/#333)", () => {
    // The pre-#333 contract, unchanged: without engine facts the feed reads the
    // volume direction and load risk, exactly as it did before #298 and #330.
    const input = buildAnalysisInput([LAST_RUN, PREVIOUS_WEEK_RUN], "trend", NOW);
    // Pin the load read so the test is about the volume branch, not the risk.
    input.progression = { ...input.progression, loadRisk: "optimal" };
    const workout = heuristicBlocks(input, NOW).find((b) => b.tool === "workoutRecommendation");

    expect(workout).toBeDefined();
    if (workout?.tool === "workoutRecommendation") {
      expect(workout.workoutType).toBe("Tempo");
      expect(workout.title).toBe("Tempo-intervaller");
    }
  });

  it("falls back to the volume-based suggestion when plan context lacks recommended", () => {
    // Repair R4: an older payload may carry the plan facts without the engine's
    // decision. The feed must then use the volume branch rather than guess.
    const ctx = context({ recommended: undefined });
    const input = buildAnalysisInput([LAST_RUN, PREVIOUS_WEEK_RUN], "trend", NOW, ctx);
    input.progression = { ...input.progression, loadRisk: "optimal" };
    // No clock: the review needs `recommended`, and this test is about the feed card.
    const workout = heuristicBlocks(input).find((b) => b.tool === "workoutRecommendation");

    expect(workout).toBeDefined();
    if (workout?.tool === "workoutRecommendation") {
      expect(workout.workoutType).toBe("Tempo");
    }
  });

  it("emits nothing without a last run or without plan context", () => {
    expect(runReviewBlock(inputWith(undefined), NOW)).toBeNull();
    expect(runReviewBlock(inputWith(context({ lastRun: null })), NOW)).toBeNull();

    const noRun = heuristicBlocks(inputWith(context({ lastRun: null })), NOW);
    expect(noRun.some((b) => b.tool === "runReview")).toBe(false);

    const noContext = heuristicBlocks(inputWith(undefined), NOW);
    expect(noContext.some((b) => b.tool === "runReview")).toBe(false);
  });

  it("says rest when a gate — here the recovery window — forbids the run", () => {
    const ctx = context({
      recommended: {
        type: "rest",
        distanceKm: 0,
        reason:
          "Kun 4 timer siden sidste løbetur — under 24-timers restitutionsbufferen før en rolig tur.",
      },
    });

    const block = runReviewBlock(inputWith(ctx), NOW);

    // #332: the review repeats the gate that rested the day, never a calendar
    // line — a non-taper rest slot only rests when such a gate holds.
    expect(block?.body).toContain("restitutionsbuffer");
    expect(block?.nextRunLabel).toContain("hviledag");
    expect(block?.nextRunLabel).toContain("24 timer");
    expect(block?.suggestedRun).toBeNull();
  });

  it("points at one of the three suggestions and does not claim the window is empty", () => {
    const ctx = context();
    const block = runReviewBlock(inputWith(ctx), NOW);
    const easy = ctx.suggestions[0];

    expect(block?.suggestedRun).toBe(
      `${easy.label} · ${formatDanish(easy.distanceKm)} km · ${easy.paceRange.min}–${easy.paceRange.max} /km`
    );
    // The run is only 4 h old, so the 24 h window is still active: the label
    // cites the window instead of claiming it is cleared.
    expect(block?.nextRunLabel).toBe("Næste løb: torsdag · tidligst 24 timer efter turen");
    expect(block?.nextRunLabel).not.toContain("klaret");
  });

  it("claims the window is cleared only when it has actually passed", () => {
    const ctx = context({
      lastRun: {
        startDate: "2026-07-05T06:00:00.000Z",
        distanceKm: 10,
        paceSecPerKm: 267,
        averageHeartrate: 165,
        movingTimeSec: 2670,
      },
    });

    const block = runReviewBlock(inputWith(ctx), NOW);

    expect(block?.nextRunLabel).toBe("Næste løb: i dag · recovery-vinduet er klaret");
  });

  it("does not promise a weekday when high load risk says rest (#330)", () => {
    // Friday evening run, Saturday morning review: the recovery window is still
    // open, and Saturday is also the plan's next run slot. With high load risk
    // that slot is not a promise — the label must say the load has to fall first.
    const runStart = new Date("2026-07-10T18:00:00.000Z");
    const saturday = new Date("2026-07-11T08:00:00.000Z");
    const ctx = context({
      loadRisk: "high",
      nextPlannedRun: "2026-07-11",
      lastRun: {
        startDate: runStart.toISOString(),
        distanceKm: 10,
        paceSecPerKm: 267,
        averageHeartrate: 165,
        movingTimeSec: 2670,
      },
      recommended: {
        type: "rest",
        distanceKm: 0,
        reason: "Høj skadesrisiko — belastningen skal falde, før et nyt pas er forsvarligt.",
      },
    });

    const input = buildAnalysisInput([activity(runStart, 10, 267, 165)], "trend", saturday, ctx);
    const block = runReviewBlock(input, saturday);

    expect(block?.nextRunLabel).toContain("når belastningen falder");
    expect(block?.nextRunLabel).not.toMatch(/Næste løb: lørdag/);
    expect(block?.suggestedRun).toBeNull();
  });

  it("never names today under high load risk, even when the plan's next run is today (#330)", () => {
    // The engine card says rest, but the context also carries today as the
    // plan's next run slot. High risk forbids promising any day, today included.
    const ctx = context({
      loadRisk: "high",
      nextPlannedRun: "2026-07-08",
      lastRun: {
        startDate: "2026-07-05T06:00:00.000Z",
        distanceKm: 10,
        paceSecPerKm: 267,
        averageHeartrate: 165,
        movingTimeSec: 2670,
      },
      recommended: {
        type: "rest",
        distanceKm: 0,
        reason: "Høj skadesrisiko — et nyt pas er ikke forsvarligt.",
      },
    });

    const input = inputWith(ctx, [activity(new Date("2026-07-05T06:00:00.000Z"), 10, 267, 165)]);
    const block = runReviewBlock(input, NOW);

    expect(block?.nextRunLabel).toBe("Næste løb: når belastningen falder.");
  });

  it("takes the later of the recovery window and the plan's next run (#330)", () => {
    // Friday evening run + 24 h → Saturday evening. The plan's next run is
    // Monday, so Monday is the earliest defensible run — not Saturday.
    const runStart = new Date("2026-07-10T18:00:00.000Z");
    const saturday = new Date("2026-07-11T08:00:00.000Z");
    const ctx = context({
      loadRisk: "optimal",
      nextPlannedRun: "2026-07-13",
      lastRun: {
        startDate: runStart.toISOString(),
        distanceKm: 10,
        paceSecPerKm: 267,
        averageHeartrate: 165,
        movingTimeSec: 2670,
      },
      recommended: {
        type: "easy",
        distanceKm: 8,
        reason: "Distance fra burn-fasens bånd (8–10 km).",
      },
    });

    const input = buildAnalysisInput([activity(runStart, 10, 267, 165)], "trend", saturday, ctx);
    const block = runReviewBlock(input, saturday);

    expect(block?.nextRunLabel).toBe("Næste løb: mandag · næste planlagte pas");
  });

  it("falls back to the reason when the recommended type is not among the suggestions", () => {
    const ctx = context({
      suggestions: context().suggestions.filter((s) => s.type !== "long"),
      recommended: {
        type: "long",
        distanceKm: 16,
        reason: "Den lange tur venter i planen.",
      },
    });

    const block = runReviewBlock(inputWith(ctx), NOW);

    expect(block?.suggestedRun).toBeNull();
    expect(block?.body).toContain("Den lange tur venter i planen.");
  });

  it("does not call an older run the week's only one when no 7-day pace exists", () => {
    const start = new Date("2026-06-28T12:00:00.000Z"); // 10 days before NOW
    const oldRun = activity(start, 10, 267, 165);
    const ctx = context({
      lastRun: {
        startDate: start.toISOString(),
        distanceKm: 10,
        paceSecPerKm: 267,
        averageHeartrate: 165,
        movingTimeSec: 2670,
      },
    });

    const block = runReviewBlock(inputWith(ctx, [oldRun]), NOW);

    expect(block?.body).not.toContain("eneste tur i den seneste uge");
    expect(block?.body).toContain("turen var for 10 dage siden");
  });

  it("keeps the window claim when the run really is the week's only one", () => {
    const onlyRun: AnalysisActivity = { startDate: LAST_START, distance: 0, movingTime: 0 };

    const block = runReviewBlock(inputWith(context(), [onlyRun]), NOW);

    expect(block?.body).toContain("den eneste tur i den seneste uge");
  });

  it("is the feed's first block when a review exists", () => {
    const blocks = heuristicBlocks(inputWith(context()), NOW);

    expect(blocks[0]?.tool).toBe("runReview");
    for (const block of blocks) {
      expect(analysisBlockSchema.safeParse(block).success).toBe(true);
    }
  });

  it("omits the review when no clock is supplied", () => {
    const blocks = heuristicBlocks(inputWith(context()));

    expect(blocks.some((b) => b.tool === "runReview")).toBe(false);
  });
});

/** The Danish weekday the engine's `getLocalDate` assigns to a date (July 8, 2026 = Wednesday). */
function getLocalDateForTest(date: Date): number {
  // 2026-07-08 is a Wednesday in every timezone — index 3 in DA_WEEKDAYS.
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).getDay();
}

describe("runReview schema", () => {
  const VALID_BLOCK = {
    tool: "runReview",
    title: "Onsdagsturen · 10,0 km",
    metric: "4:27 /km · 165 bpm",
    body: "Turen tog 45 min — på niveau med dit 7-dages snit på 4:27 /km.",
    nextRunLabel: "Næste løb: torsdag · hviledag nu — tidligst 24 timer efter turen",
    suggestedRun: null,
  } as const;

  it("accepts a runReview block through the analysis union, with and without a suggestion", () => {
    expect(analysisBlockSchema.safeParse(VALID_BLOCK).success).toBe(true);
    expect(
      analysisBlockSchema.safeParse({
        ...VALID_BLOCK,
        suggestedRun: "Let pas · 9,0 km · 5:45–6:15 /km",
      }).success
    ).toBe(true);
  });

  it("rejects an unknown tool", () => {
    expect(analysisBlockSchema.safeParse({ ...VALID_BLOCK, tool: "bogus" }).success).toBe(false);
  });

  it("keeps the engine's phase contract in sync with what the review receives", () => {
    // The context's phase is the engine's own vocabulary — a smoke check that the
    // builder and the review speak the same phase names.
    expect(getCurrentPhase(NOW, new Date(2026, 8, 20))).toBe("burn");
  });
});
