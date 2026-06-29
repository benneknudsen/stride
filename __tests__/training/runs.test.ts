import { describe, expect, it } from "vitest";
import type { Goal, GoalKey, ZoneKey } from "../../lib/training/goals";
import { GOALS } from "../../lib/training/goals";
import { LATEST_RUN, PAST_RUNS } from "../../lib/training/mock-runs";
import { getTrainingData, NEXT_INDEX, TODAY_INDEX } from "../../lib/training/runs";

const GOAL_KEYS = Object.keys(GOALS) as GoalKey[];
const ALL_ZONES: ZoneKey[] = ["z1", "z2", "z3", "z4", "z5"];

describe("runs.ts re-exports", () => {
  it("re-exports TODAY_INDEX from mock-runs", () => {
    expect(TODAY_INDEX).toBe(2);
  });

  it("re-exports NEXT_INDEX from mock-runs", () => {
    expect(NEXT_INDEX).toBe(3);
  });

  it("keeps TODAY_INDEX before NEXT_INDEX within the Mon–Sun strip", () => {
    expect(TODAY_INDEX).toBeLessThan(NEXT_INDEX);
    expect(TODAY_INDEX).toBeGreaterThanOrEqual(0);
    expect(NEXT_INDEX).toBeLessThanOrEqual(6);
  });
});

describe("getTrainingData — overall shape", () => {
  it("returns the four dashboard sections", () => {
    const data = getTrainingData(GOALS.marathon);
    expect(data).toHaveProperty("latest");
    expect(data).toHaveProperty("runs");
    expect(data).toHaveProperty("trend");
    expect(data).toHaveProperty("drivers");
  });

  it("passes the seeded LATEST_RUN straight through", () => {
    const data = getTrainingData(GOALS.marathon);
    expect(data.latest).toBe(LATEST_RUN);
  });

  it("passes the seeded PAST_RUNS straight through", () => {
    const data = getTrainingData(GOALS.marathon);
    expect(data.runs).toBe(PAST_RUNS);
  });

  it("returns exactly three trend chips", () => {
    const data = getTrainingData(GOALS.marathon);
    expect(data.trend).toHaveLength(3);
  });

  it("returns exactly three next-run drivers", () => {
    const data = getTrainingData(GOALS.marathon);
    expect(data.drivers).toHaveLength(3);
  });

  it.each(GOAL_KEYS)("returns the same shape for every goal (%s)", (key) => {
    const data = getTrainingData(GOALS[key]);
    expect(data.latest).toBe(LATEST_RUN);
    expect(data.runs).toBe(PAST_RUNS);
    expect(data.trend).toHaveLength(3);
    expect(data.drivers).toHaveLength(3);
  });
});

describe("getTrainingData — latest run payload", () => {
  it("exposes every field the 01 Latest run card reads", () => {
    const { latest } = getTrainingData(GOALS.marathon);
    expect(latest).toMatchObject({
      title: expect.any(String),
      when: expect.any(String),
      distanceKm: expect.any(Number),
      duration: expect.any(String),
      pace: expect.any(String),
      avgHr: expect.any(Number),
      cadence: expect.any(Number),
      elevGain: expect.any(Number),
    });
  });

  it("carries an evenly-spaced numeric pace trace", () => {
    const { latest } = getTrainingData(GOALS.marathon);
    expect(Array.isArray(latest.paceTrace)).toBe(true);
    expect(latest.paceTrace.length).toBeGreaterThan(0);
    for (const sample of latest.paceTrace) {
      expect(typeof sample).toBe("number");
    }
  });

  it("carries a zone distribution covering all five zones that sums to ~100", () => {
    const { latest } = getTrainingData(GOALS.marathon);
    for (const zone of ALL_ZONES) {
      expect(latest.zoneDistribution).toHaveProperty(zone);
      expect(typeof latest.zoneDistribution[zone]).toBe("number");
    }
    const total = ALL_ZONES.reduce((sum, z) => sum + latest.zoneDistribution[z], 0);
    expect(total).toBeCloseTo(100, 0);
  });
});

describe("getTrainingData — past runs payload", () => {
  it("returns past runs with the bar-chart fields", () => {
    const { runs } = getTrainingData(GOALS.marathon);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run).toMatchObject({
        day: expect.any(String),
        distanceKm: expect.any(Number),
        pace: expect.any(String),
        zone: expect.any(String),
      });
      expect(ALL_ZONES).toContain(run.zone);
    }
  });
});

describe("getTrainingData — trend chips", () => {
  it("always leads with weekly volume and avg pace", () => {
    const { trend } = getTrainingData(GOALS.marathon);
    expect(trend[0].label).toBe("Weekly volume");
    expect(trend[1].label).toBe("Avg pace");
  });

  it("gives every chip a valid direction", () => {
    const { trend } = getTrainingData(GOALS.efficient);
    for (const chip of trend) {
      expect(chip).toMatchObject({
        label: expect.any(String),
        value: expect.any(String),
        delta: expect.any(String),
      });
      expect(["up", "down", "flat"]).toContain(chip.direction);
    }
  });

  it("shows a stronger, trending-up Zone 2 adherence chip for the zone2 plan", () => {
    const { trend } = getTrainingData(GOALS.zone2);
    const z2 = trend.find((t) => t.label === "Zone 2 adherence");
    expect(z2).toBeDefined();
    expect(z2).toMatchObject({ value: "82%", delta: "+6%", direction: "up" });
  });

  it.each(
    GOAL_KEYS.filter((k) => k !== "zone2")
  )("shows the flat baseline Zone 2 adherence chip for non-zone2 plan (%s)", (key) => {
    const { trend } = getTrainingData(GOALS[key]);
    const z2 = trend.find((t) => t.label === "Zone 2 adherence");
    expect(z2).toMatchObject({ value: "74%", delta: "0%", direction: "flat" });
  });

  it("never emits two Zone 2 adherence chips", () => {
    for (const key of GOAL_KEYS) {
      const { trend } = getTrainingData(GOALS[key]);
      const z2Chips = trend.filter((t) => t.label === "Zone 2 adherence");
      expect(z2Chips).toHaveLength(1);
    }
  });
});

describe("getTrainingData — next-run drivers", () => {
  it("returns recovery, trend and plan drivers in order", () => {
    const { drivers } = getTrainingData(GOALS.marathon);
    expect(drivers.map((d) => d.key)).toEqual(["recovery", "trend", "plan"]);
  });

  it("derives the plan driver value from the goal's short label", () => {
    for (const key of GOAL_KEYS) {
      const goal = GOALS[key];
      const { drivers } = getTrainingData(goal);
      const plan = drivers.find((d) => d.key === "plan");
      expect(plan?.value).toBe(goal.short);
      expect(plan?.label).toBe("Plan");
    }
  });

  it("keeps the recovery and trend drivers plan-independent", () => {
    const a = getTrainingData(GOALS.c25k).drivers;
    const b = getTrainingData(GOALS.efficient).drivers;
    expect(a.find((d) => d.key === "recovery")).toEqual(b.find((d) => d.key === "recovery"));
    expect(a.find((d) => d.key === "trend")).toEqual(b.find((d) => d.key === "trend"));
  });
});

describe("getTrainingData — purity & isolation", () => {
  it("does not mutate the goal it is given", () => {
    const goal = GOALS.zone2;
    const snapshot = JSON.parse(JSON.stringify(goal));
    getTrainingData(goal);
    expect(goal).toEqual(snapshot);
  });

  it("produces equal output for repeated calls with the same goal", () => {
    expect(getTrainingData(GOALS.marathon)).toEqual(getTrainingData(GOALS.marathon));
  });

  it("reflects a custom goal's short label and zone2 key", () => {
    const custom: Goal = {
      ...GOALS.zone2,
      key: "zone2",
      short: "my custom base",
    };
    const { drivers, trend } = getTrainingData(custom);
    expect(drivers.find((d) => d.key === "plan")?.value).toBe("my custom base");
    expect(trend.find((t) => t.label === "Zone 2 adherence")?.direction).toBe("up");
  });
});
