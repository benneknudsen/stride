import { describe, expect, it } from "vitest";
import {
  type AnalysisActivity,
  type AnalysisInput,
  analysisInputHash,
  buildAnalysisInput,
  buildAnalysisPrompt,
  coachInsightBlock,
  heuristicBlocks,
} from "@/lib/ai/analysis";
import {
  analysisBlockSchema,
  blockToToolCall,
  coachInsightSchema,
  toolCallToBlock,
} from "@/lib/ai/tools";

const NOW = new Date("2026-06-29T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** Build a run `daysAgo` before NOW with the given km / pace (min per km). */
function run(daysAgo: number, km: number, paceMinPerKm: number, hr?: number): AnalysisActivity {
  const distance = km * 1000;
  const movingTime = Math.round(km * paceMinPerKm * 60);
  return {
    startDate: new Date(NOW.getTime() - daysAgo * DAY_MS),
    distance,
    movingTime,
    averageSpeed: distance / movingTime,
    averageHeartrate: hr ?? null,
    totalElevationGain: 20,
  };
}

/** Evenly spread runs across the trailing 4 weeks — a steady, optimal load. */
const STEADY: AnalysisActivity[] = [1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26, 29].map((d) =>
  run(d, 8, 5.2, 150)
);

/** One old anchor run, then a sudden heavy week — acute:chronic spikes high. */
const SPIKED: AnalysisActivity[] = [
  run(30, 4, 5.5, 145),
  run(1, 12, 5.2, 155),
  run(3, 12, 5.2, 155),
  run(5, 12, 5.2, 155),
];

const VALID_BLOCK = {
  tool: "coachInsight",
  type: "warning",
  title: "Load is climbing fast",
  body: "Your acute load is well above your chronic base.",
  data: { label: "Load ratio", value: "1.62", direction: "up", changeLabel: "+38%" },
  action: "Plan an easy week",
} as const;

describe("coachInsight schema", () => {
  it("accepts a full coachInsight block through the analysis union", () => {
    const parsed = analysisBlockSchema.safeParse(VALID_BLOCK);
    expect(parsed.success).toBe(true);
  });

  it("accepts a block without the optional action and changeLabel", () => {
    const { action: _a, ...rest } = VALID_BLOCK;
    const { changeLabel: _c, ...data } = VALID_BLOCK.data;
    const parsed = coachInsightSchema.safeParse({ ...rest, data });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown insight type", () => {
    const parsed = coachInsightSchema.safeParse({ ...VALID_BLOCK, type: "celebration" });
    expect(parsed.success).toBe(false);
  });

  it("round-trips through blockToToolCall and toolCallToBlock", () => {
    const block = analysisBlockSchema.parse(VALID_BLOCK);
    const call = blockToToolCall(block);
    expect(call.name).toBe("coachInsight");
    expect(toolCallToBlock(call)).toEqual(block);
  });
});

describe("buildAnalysisInput progression", () => {
  it("reports no progression metrics with under 4 weeks of history", () => {
    const input = buildAnalysisInput([run(1, 8, 5.0, 150), run(3, 10, 5.2, 152)], "overall", NOW);
    expect(input.progression.hasFullWindow).toBe(false);
    expect(input.progression.loadRatio).toBeNull();
    expect(input.progression.loadRisk).toBeNull();
  });

  it("computes load ratio and risk from a full 4-week window", () => {
    const input = buildAnalysisInput(STEADY, "overall", NOW);
    expect(input.progression.hasFullWindow).toBe(true);
    expect(input.progression.loadRatio).not.toBeNull();
    expect(input.progression.loadRisk).toBe("optimal");
    expect(input.progression.volumeKm).toBeGreaterThan(0);
  });

  it("changes the input hash when progression data differs", () => {
    const a = analysisInputHash(buildAnalysisInput(STEADY, "overall", NOW));
    const b = analysisInputHash(buildAnalysisInput(SPIKED, "overall", NOW));
    expect(a).not.toBe(b);
  });

  it("includes the training load in the prompt", () => {
    const prompt = buildAnalysisPrompt(buildAnalysisInput(STEADY, "overall", NOW));
    expect(prompt).toMatch(/load ratio/i);
  });
});

function inputWith(progression: Partial<AnalysisInput["progression"]>): AnalysisInput {
  return {
    ...buildAnalysisInput(STEADY, "overall", NOW),
    progression: { ...buildAnalysisInput(STEADY, "overall", NOW).progression, ...progression },
  };
}

describe("coachInsightBlock", () => {
  it("returns null without a full history window", () => {
    const input = buildAnalysisInput([run(1, 8, 5.0, 150)], "overall", NOW);
    expect(coachInsightBlock(input)).toBeNull();
  });

  it("emits a warning when the load ratio is high", () => {
    const block = coachInsightBlock(buildAnalysisInput(SPIKED, "overall", NOW));
    expect(block).not.toBeNull();
    expect(block).toMatchObject({ tool: "coachInsight", type: "warning" });
    if (block?.tool === "coachInsight") {
      expect(block.data.direction).toBe("up");
      expect(block.action).toBeTruthy();
    }
  });

  it("emits a milestone at 100 km of 4-week volume", () => {
    const block = coachInsightBlock(inputWith({ loadRisk: "optimal", volumeKm: 104.2 }));
    expect(block).toMatchObject({ tool: "coachInsight", type: "milestone" });
  });

  it("emits an insight when the athlete is ready to increase", () => {
    const block = coachInsightBlock(
      inputWith({ loadRisk: "optimal", volumeKm: 60, readyToIncrease: true })
    );
    expect(block).toMatchObject({ tool: "coachInsight", type: "insight" });
  });

  it("is appended to heuristicBlocks when progression warrants it", () => {
    const blocks = heuristicBlocks(buildAnalysisInput(SPIKED, "overall", NOW));
    const coach = blocks.filter((b) => b.tool === "coachInsight");
    expect(coach).toHaveLength(1);
    // Every emitted block must satisfy the streaming union.
    for (const b of blocks) expect(analysisBlockSchema.safeParse(b).success).toBe(true);
  });
});
