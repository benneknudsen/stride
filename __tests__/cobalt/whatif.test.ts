import { describe, expect, it } from "vitest";
import { gapDuration, gapSentence, goalGap, goalPaceLabel } from "@/lib/cobalt/whatif";

// The "hvad hvis" card (issue #340) asks one arithmetic question: how far does
// the runner's own goal sit from what their current basis predicts? The answer
// is a difference between two numbers the view-model already derived — nothing
// is projected and nothing is promised, so the gap is pure arithmetic. These
// tests pin both the arithmetic and the wording that tells the runner which way
// the gap points.

const HALF = 21.0975;

describe("goalGap", () => {
  it("counts a goal faster than the prediction as a negative gap", () => {
    const gap = goalGap(5400, 5700, HALF);
    expect(gap.seconds).toBe(-300);
    expect(gap.secondsPerKm).toBe(-14);
    expect(gap.direction).toBe("faster");
  });

  it("counts a goal slower than the prediction as a positive gap", () => {
    const gap = goalGap(6000, 5700, HALF);
    expect(gap.seconds).toBe(300);
    expect(gap.secondsPerKm).toBe(14);
    expect(gap.direction).toBe("slower");
  });

  it("reports an exact match as no gap at all", () => {
    const gap = goalGap(5700, 5700, HALF);
    expect(gap.seconds).toBe(0);
    expect(gap.secondsPerKm).toBe(0);
    expect(gap.direction).toBe("even");
  });

  it("carries the goal's own pace", () => {
    expect(goalGap(2700, 3000, 10).goalPaceSecPerKm).toBeCloseTo(270, 6);
  });
});

describe("gapSentence", () => {
  it("says what a faster goal demands, in seconds per km", () => {
    expect(gapSentence(goalGap(5400, 5700, HALF))).toBe(
      "Målet kræver 14 sek/km hurtigere end din prognose."
    );
  });

  it("says what a slower goal leaves in hand", () => {
    expect(gapSentence(goalGap(6000, 5700, HALF))).toBe(
      "Du har 14 sek/km i hus — målet er langsommere end din prognose."
    );
  });

  it("says when the goal sits exactly on the prediction", () => {
    expect(gapSentence(goalGap(5700, 5700, HALF))).toBe("Målet ligger præcis på din prognose.");
  });

  it("falls back to the seconds when the gap is under half a second per km", () => {
    // 10 s over a marathon is 0,24 s/km — the pace difference would read as 0.
    const gap = goalGap(5710, 5700, 42.195);
    expect(gap.secondsPerKm).toBe(0);
    expect(gapSentence(gap)).toBe("Målet afviger 10 sekunder fra din prognose.");
  });
});

describe("gapDuration", () => {
  it("prints the whole time the goal sits away from the prediction", () => {
    expect(gapDuration(goalGap(5400, 5700, HALF))).toBe("5:00");
    expect(gapDuration(goalGap(5700, 5700, HALF))).toBe("0:00");
  });
});

describe("goalPaceLabel", () => {
  it("prints the goal's own pace as a clock", () => {
    expect(goalPaceLabel(goalGap(2700, 3000, 10))).toBe("4:30");
  });
});
