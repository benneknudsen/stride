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

  it("emits nothing without a last run or without plan context", () => {
    expect(runReviewBlock(inputWith(undefined), NOW)).toBeNull();
    expect(runReviewBlock(inputWith(context({ lastRun: null })), NOW)).toBeNull();

    const noRun = heuristicBlocks(inputWith(context({ lastRun: null })), NOW);
    expect(noRun.some((b) => b.tool === "runReview")).toBe(false);

    const noContext = heuristicBlocks(inputWith(undefined), NOW);
    expect(noContext.some((b) => b.tool === "runReview")).toBe(false);
  });

  it("says rest when the run happened inside the recovery window", () => {
    const ctx = context({
      recommended: {
        type: "rest",
        distanceKm: 0,
        reason:
          "Kun 4 timer siden sidste løbetur — under 24-timers restitutionsbufferen før en rolig tur.",
      },
    });

    const block = runReviewBlock(inputWith(ctx), NOW);

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
