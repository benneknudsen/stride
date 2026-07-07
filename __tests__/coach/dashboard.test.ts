import { describe, expect, it } from "vitest";
import {
  buildCoachDashboard,
  buildLoadGauge,
  buildPaceEfficiencySeries,
  buildVolumeSeries,
  buildWeekStrip,
  buildZoneSeries,
  type CoachActivityInput,
  LOAD_RISK_LABELS,
} from "@/lib/coach/dashboard";
import { getWeekPlan } from "@/lib/coach/engine";
import type { ProgressionSnapshot } from "@/lib/training/progression";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// Burn phase (6 Jul – 2 Aug 2026): Wed is an easy day, Tue a rest day.
const BURN_WEDNESDAY = new Date(2026, 6, 15, 8, 0);
const BURN_TUESDAY = new Date(2026, 6, 14, 8, 0);

/** A run `daysAgo` days before `asOf`; hrZones omitted like demo fixtures. */
function run(
  asOf: Date,
  daysAgo: number,
  overrides: Partial<CoachActivityInput> = {}
): CoachActivityInput {
  return {
    type: "Run",
    distance: 10_000,
    movingTime: 3_000,
    averageHeartrate: 145,
    startDate: new Date(asOf.getTime() - daysAgo * DAY_MS),
    ...overrides,
  };
}

/** ~10 weeks of steady history: one 10 km run every 3rd day. */
function steadyHistory(asOf: Date): CoachActivityInput[] {
  return Array.from({ length: 24 }, (_, i) => run(asOf, i * 3 + 2));
}

function snapshot(overrides: Partial<ProgressionSnapshot> = {}): ProgressionSnapshot {
  return {
    date: BURN_WEDNESDAY,
    hasFullWindow: true,
    paceEfficiency: 4.2,
    hrStability: 85,
    trainingLoad: { acute: 30, chronic: 30, ratio: 1.0, risk: "optimal" },
    zone2Percent: 90,
    volumeKm: 120,
    readyToIncrease: false,
    ...overrides,
  };
}

describe("buildPaceEfficiencySeries", () => {
  it("maps snapshots to week-labelled efficiency points in order", () => {
    const series = buildPaceEfficiencySeries([
      snapshot({ date: new Date(2026, 6, 1), paceEfficiency: 4.1 }),
      snapshot({ date: new Date(2026, 6, 8), paceEfficiency: 4.3 }),
    ]);
    expect(series).toHaveLength(2);
    expect(series[0].efficiency).toBe(4.1);
    expect(series[1].efficiency).toBe(4.3);
  });

  it("labels each point with the snapshot's day/month", () => {
    const series = buildPaceEfficiencySeries([snapshot({ date: new Date(2026, 6, 15) })]);
    expect(series[0].week).toBe("15/7");
  });

  it("keeps null efficiency as null so the chart renders a gap", () => {
    const series = buildPaceEfficiencySeries([snapshot({ paceEfficiency: null })]);
    expect(series[0].efficiency).toBeNull();
  });
});

describe("buildVolumeSeries", () => {
  it("sums running km into one bucket per week, oldest first", () => {
    const asOf = BURN_WEDNESDAY;
    const activities = [
      run(asOf, 1, { distance: 12_000 }), // current week
      run(asOf, 3, { distance: 8_000 }), // current week
      run(asOf, 10, { distance: 15_000 }), // previous week
    ];
    const series = buildVolumeSeries(activities, 2, asOf);
    expect(series).toHaveLength(2);
    expect(series[0].km).toBe(15);
    expect(series[1].km).toBe(20);
  });

  it("ignores non-run activities", () => {
    const asOf = BURN_WEDNESDAY;
    const activities = [
      run(asOf, 1, { distance: 10_000 }),
      run(asOf, 2, { type: "Ride", distance: 40_000 }),
    ];
    const series = buildVolumeSeries(activities, 1, asOf);
    expect(series[0].km).toBe(10);
  });

  it("returns zero-km weeks when nothing was logged", () => {
    const series = buildVolumeSeries([], 3, BURN_WEDNESDAY);
    expect(series).toHaveLength(3);
    expect(series.every((w) => w.km === 0)).toBe(true);
  });
});

describe("buildZoneSeries", () => {
  it("produces one stacked entry per week with percentages summing to ~100", () => {
    const asOf = BURN_WEDNESDAY;
    const activities = [
      run(asOf, 1, { averageHeartrate: 130 }), // z2 at default max HR
      run(asOf, 3, { averageHeartrate: 165 }), // z3
    ];
    const series = buildZoneSeries(activities, 2, asOf);
    expect(series).toHaveLength(2);
    const latest = series[1];
    const total = latest.z1 + latest.z2 + latest.z3 + latest.z4 + latest.z5;
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
  });

  it("uses a rolling 4-week window per bar, not just that week's runs", () => {
    const asOf = BURN_WEDNESDAY;
    // A single run 20 days ago: outside the latest calendar week, but inside
    // the latest bar's rolling 28-day window.
    const activities = [run(asOf, 20, { averageHeartrate: 130 })];
    const series = buildZoneSeries(activities, 1, asOf);
    expect(series[0].z2).toBeGreaterThan(0);
  });

  it("renders all-zero weeks when no HR-carrying run is in the window", () => {
    const asOf = BURN_WEDNESDAY;
    const activities = [run(asOf, 1, { averageHeartrate: null })];
    const series = buildZoneSeries(activities, 1, asOf);
    const bar = series[0];
    expect(bar.z1 + bar.z2 + bar.z3 + bar.z4 + bar.z5).toBe(0);
  });
});

describe("buildLoadGauge", () => {
  it("maps an optimal ratio to its band, label and gauge fraction", () => {
    const gauge = buildLoadGauge({ acute: 30, chronic: 30, ratio: 1.0, risk: "optimal" });
    expect(gauge.risk).toBe("optimal");
    expect(gauge.fraction).toBeCloseTo(0.5);
    expect(gauge.label).toBe(LOAD_RISK_LABELS.optimal);
    expect(gauge.ratio).toBe(1.0);
  });

  it("clamps the fraction to 1 for ratios above 2 and flags high risk", () => {
    const gauge = buildLoadGauge({ acute: 75, chronic: 30, ratio: 2.5, risk: "high" });
    expect(gauge.fraction).toBe(1);
    expect(gauge.risk).toBe("high");
    expect(gauge.label).toBe(LOAD_RISK_LABELS.high);
  });

  it("handles an unknown ratio with a zero fraction and fallback label", () => {
    const gauge = buildLoadGauge({ acute: 10, chronic: null, ratio: null, risk: null });
    expect(gauge.fraction).toBe(0);
    expect(gauge.ratio).toBeNull();
    expect(gauge.risk).toBeNull();
    expect(gauge.label).toBe(LOAD_RISK_LABELS.unknown);
  });
});

describe("buildWeekStrip", () => {
  it("returns seven days keyed mon → sun", () => {
    const strip = buildWeekStrip(getWeekPlan("burn"), BURN_WEDNESDAY);
    expect(strip.map((d) => d.weekday)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  });

  it("marks today from the given date", () => {
    const strip = buildWeekStrip(getWeekPlan("burn"), BURN_WEDNESDAY);
    expect(strip[2].isToday).toBe(true);
    expect(strip.filter((d) => d.isToday)).toHaveLength(1);
  });

  it("marks today as the next session when today is a run day", () => {
    // Burn Wednesday is an easy run day.
    const strip = buildWeekStrip(getWeekPlan("burn"), BURN_WEDNESDAY);
    expect(strip[2].isNext).toBe(true);
    expect(strip.filter((d) => d.isNext)).toHaveLength(1);
  });

  it("points next at the following run day when today is a rest day", () => {
    // Burn Tuesday is a rest day; Wednesday is the next run.
    const strip = buildWeekStrip(getWeekPlan("burn"), BURN_TUESDAY);
    expect(strip[1].isToday).toBe(true);
    expect(strip[1].isNext).toBe(false);
    expect(strip[2].isNext).toBe(true);
  });

  it("marks no next session when only rest days remain this week", () => {
    const allRest = getWeekPlan("burn").map((day) => ({
      ...day,
      type: "rest" as const,
      description: "Hvile",
    }));
    const strip = buildWeekStrip(allRest, BURN_WEDNESDAY);
    expect(strip.every((d) => !d.isNext)).toBe(true);
  });
});

describe("buildCoachDashboard", () => {
  it("assembles workout card, week strip and all three progression series", () => {
    const dashboard = buildCoachDashboard(steadyHistory(BURN_WEDNESDAY), BURN_WEDNESDAY);
    expect(dashboard.workout.type).toBeDefined();
    expect(dashboard.workout.reason.length).toBeGreaterThan(0);
    expect(dashboard.weekStrip).toHaveLength(7);
    expect(dashboard.paceSeries.length).toBeGreaterThan(0);
    expect(dashboard.zoneSeries.length).toBe(dashboard.paceSeries.length);
    expect(dashboard.volumeSeries.length).toBe(dashboard.paceSeries.length);
    expect(dashboard.loadGauge.label).toBeTruthy();
  });

  it("derives lastRun from the newest run so a fresh run forces a rest card", () => {
    const asOf = BURN_WEDNESDAY;
    const activities = [...steadyHistory(asOf), run(asOf, 0.5)]; // 12 h ago
    const dashboard = buildCoachDashboard(activities, asOf);
    expect(dashboard.workout.type).toBe("rest");
  });

  it("is JSON-serializable (no Date instances or undefined gaps)", () => {
    const dashboard = buildCoachDashboard(steadyHistory(BURN_WEDNESDAY), BURN_WEDNESDAY);
    const roundTrip = JSON.parse(JSON.stringify(dashboard));
    expect(roundTrip).toEqual(dashboard);
  });
});
