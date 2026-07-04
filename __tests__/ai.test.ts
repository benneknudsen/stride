import { describe, expect, it } from "vitest";
import {
  type AnalysisActivity,
  analysisInputHash,
  buildAnalysisInput,
  formatPaceSecPerKm,
  heuristicBlocks,
} from "@/lib/ai/analysis";
import { analysisBlockSchema, blockToToolCall, toolCallToBlock } from "@/lib/ai/tools";

const NOW = new Date("2026-06-29T12:00:00.000Z");

/** Build a run `daysAgo` before NOW with the given km / pace (min per km). */
function run(daysAgo: number, km: number, paceMinPerKm: number, hr?: number): AnalysisActivity {
  const distance = km * 1000;
  const movingTime = Math.round(km * paceMinPerKm * 60);
  return {
    startDate: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000),
    distance,
    movingTime,
    averageSpeed: distance / movingTime,
    averageHeartrate: hr ?? null,
    totalElevationGain: 20,
  };
}

const SAMPLE: AnalysisActivity[] = [
  run(1, 8, 5.0, 150),
  run(3, 10, 5.2, 152),
  run(5, 6, 5.5, 145),
  run(9, 7, 5.4, 148),
  run(11, 9, 5.3, 150),
];

describe("buildAnalysisInput", () => {
  it("summarises totals and windows deterministically", () => {
    const input = buildAnalysisInput(SAMPLE, "overall", NOW);
    expect(input.totalRuns).toBe(5);
    expect(input.totalDistanceKm).toBe(40);
    expect(input.longestRunKm).toBe(10);
    // last 7 days = runs at 1, 3, 5 days ago (24 km); prior 7 = 9, 11 days ago.
    expect(input.weeklyVolumeKm[0]).toBe(24);
    expect(input.avgPaceLast7).not.toBeNull();
    expect(input.avgPacePrev7).not.toBeNull();
  });

  it("is order-independent for the hash", () => {
    const a = analysisInputHash(buildAnalysisInput(SAMPLE, "overall", NOW));
    const b = analysisInputHash(buildAnalysisInput([...SAMPLE].reverse(), "overall", NOW));
    expect(a).toBe(b);
  });

  it("changes the hash when the scope changes", () => {
    const a = analysisInputHash(buildAnalysisInput(SAMPLE, "overall", NOW));
    const b = analysisInputHash(buildAnalysisInput(SAMPLE, "weekly", NOW));
    expect(a).not.toBe(b);
  });
});

describe("formatPaceSecPerKm", () => {
  it("formats seconds-per-km as m:ss", () => {
    expect(formatPaceSecPerKm(300)).toBe("5:00");
    expect(formatPaceSecPerKm(330)).toBe("5:30");
  });

  it("guards null and non-positive values", () => {
    expect(formatPaceSecPerKm(null)).toBe("--:--");
    expect(formatPaceSecPerKm(0)).toBe("--:--");
  });
});

describe("heuristicBlocks", () => {
  it("produces only schema-valid blocks", () => {
    const blocks = heuristicBlocks(buildAnalysisInput(SAMPLE, "overall", NOW));
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const block of blocks) {
      expect(analysisBlockSchema.safeParse(block).success).toBe(true);
    }
  });

  it("is deterministic for identical input", () => {
    const input = buildAnalysisInput(SAMPLE, "overall", NOW);
    expect(JSON.stringify(heuristicBlocks(input))).toBe(JSON.stringify(heuristicBlocks(input)));
  });

  it("emits a workout recommendation", () => {
    const blocks = heuristicBlocks(buildAnalysisInput(SAMPLE, "overall", NOW));
    expect(blocks.some((b) => b.tool === "workoutRecommendation")).toBe(true);
  });

  it("never renders a pace delta with 60 in the seconds place", () => {
    // 59.6 s delta used to round the remainder alone and produce "0:60".
    const input = buildAnalysisInput(SAMPLE, "overall", NOW);
    const crafted = { ...input, avgPaceLast7: 359.6, avgPacePrev7: 300 };
    const comparison = heuristicBlocks(crafted).find((b) => b.tool === "metricComparison");
    expect(comparison).toBeDefined();
    if (comparison?.tool === "metricComparison") {
      expect(comparison.deltaLabel).toBe("+1:00");
    }
  });
});

describe("blockToToolCall / toolCallToBlock", () => {
  it("round-trips a block through its persisted shape", () => {
    const [block] = heuristicBlocks(buildAnalysisInput(SAMPLE, "overall", NOW));
    const call = blockToToolCall(block);
    expect(call.name).toBe(block.tool);
    expect(toolCallToBlock(call)).toEqual(block);
  });

  it("rejects an unknown tool name", () => {
    expect(toolCallToBlock({ name: "bogusTool", args: {} })).toBeNull();
  });
});
