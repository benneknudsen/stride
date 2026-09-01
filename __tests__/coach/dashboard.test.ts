import { describe, expect, it } from "vitest";
import {
  buildCoachDashboard,
  buildLoadGauge,
  buildPaceEfficiencySeries,
  buildVolumeSeries,
  buildZoneSeries,
  type CoachActivityInput,
  DASHBOARD_WEEKS,
  LOAD_RISK_LABELS,
} from "@/lib/coach/dashboard";
import { buildPhases } from "@/lib/coach/engine";
import type { ProgressionSnapshot } from "@/lib/training/progression";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// The dashboard is parameterised on the race date (issue #99): anchors derive
// from this pinned race via the engine's phase blocks, never from calendar
// literals. In the burn phase, Wed is an easy day.
const TEST_RACE_DATE = new Date(2026, 8, 20);

/** First date with the given JS weekday (0 = Sun) inside a phase, at 08:00. */
function anchorIn(phase: "burn" | "peak", jsWeekday: number): Date {
  const d = new Date(buildPhases(TEST_RACE_DATE)[phase].startDate);
  while (d.getDay() !== jsWeekday) d.setDate(d.getDate() + 1);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0);
}

const BURN_WEDNESDAY = anchorIn("burn", 3);
// Burn runs mon/wed/fri/sun, so Tuesday is a planned hviledag — the day the two
// cards used to contradict each other (#260).
const BURN_REST_DAY = anchorIn("burn", 2);
// Peak is the only phase whose week plan carries a long run (Sundays) — the one
// place today's pas can collide with the variation's long Zone 2-tur (#255).
const PEAK_MONDAY = anchorIn("peak", 1);

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

describe("buildCoachDashboard", () => {
  it("assembles workout card, next-activity card and all three progression series", () => {
    const dashboard = buildCoachDashboard(
      steadyHistory(BURN_WEDNESDAY),
      BURN_WEDNESDAY,
      DASHBOARD_WEEKS,
      TEST_RACE_DATE
    );
    expect(dashboard.workout.type).toBeDefined();
    expect(dashboard.workout.reason.length).toBeGreaterThan(0);
    expect(dashboard.nextActivity.type).toBeDefined();
    expect(dashboard.nextActivity.reason.length).toBeGreaterThan(0);
    expect(dashboard.paceSeries.length).toBeGreaterThan(0);
    expect(dashboard.zoneSeries.length).toBe(dashboard.paceSeries.length);
    expect(dashboard.volumeSeries.length).toBe(dashboard.paceSeries.length);
    expect(dashboard.loadGauge.label).toBeTruthy();
  });

  it("derives lastRun from the newest run so a fresh run forces a rest card", () => {
    const asOf = BURN_WEDNESDAY;
    const activities = [...steadyHistory(asOf), run(asOf, 0.5)]; // 12 h ago
    const dashboard = buildCoachDashboard(activities, asOf, DASHBOARD_WEEKS, TEST_RACE_DATE);
    expect(dashboard.workout.type).toBe("rest");
  });

  it("exposes hoursSinceLastRun from the newest run of any intensity (#273)", () => {
    const asOf = BURN_WEDNESDAY;
    // steadyHistory's newest run is 2 days old at an easy 145 bpm (Z3) — the
    // hard-effort read never sees it, the last-run read must.
    const dashboard = buildCoachDashboard(
      steadyHistory(asOf),
      asOf,
      DASHBOARD_WEEKS,
      TEST_RACE_DATE
    );
    expect(dashboard.hoursSinceLastRun).toBeCloseTo(48);
    expect(dashboard.hoursSinceHardEffort).toBeNull();
  });

  it("reads a run 12 h ago as inside the same-day window (#273)", () => {
    const asOf = BURN_WEDNESDAY;
    const activities = [...steadyHistory(asOf), run(asOf, 0.5)];
    const dashboard = buildCoachDashboard(activities, asOf, DASHBOARD_WEEKS, TEST_RACE_DATE);
    expect(dashboard.hoursSinceLastRun).toBeCloseTo(12);
  });

  it("never lets the variation prescribe the same run type as today's pas (#255)", () => {
    // Two weeks of consecutive days in each of the two phases: whatever the plan
    // slots in, the variation must name a different session — hvile on both
    // cards is the one allowed overlap, since a body asking for restitution
    // outranks variety.
    const seen = new Set<string>();
    for (const anchor of [BURN_WEDNESDAY, PEAK_MONDAY]) {
      for (let day = 0; day < 14; day++) {
        const asOf = new Date(anchor.getTime() + day * DAY_MS);
        const dashboard = buildCoachDashboard(
          steadyHistory(asOf),
          asOf,
          DASHBOARD_WEEKS,
          TEST_RACE_DATE
        );
        seen.add(dashboard.workout.type);
        if (dashboard.workout.type === "rest") {
          // #260: a hviledag on "Næste pas" is never answered with a run.
          expect(dashboard.nextActivity.type).toBe("rest");
          continue;
        }
        if (dashboard.nextActivity.type === "rest") continue;
        expect(dashboard.nextActivity.type).not.toBe(dashboard.workout.type);
      }
    }
    // Guard against a vacuous sweep: the steady history's variation is the long
    // Zone 2-tur, so the run must actually cover a day the plan schedules one —
    // and a hviledag, so the #260 branch above is really exercised.
    expect(seen.has("long")).toBe(true);
    expect(seen.has("rest")).toBe(true);
  });

  it("never puts a run next to a planned hviledag (#260)", () => {
    // A rest slot in the burn phase's week plan: the pas is hvile for a reason
    // the variation cannot see, and before #260 it prescribed straight through
    // it — "Næste pas: Hvile" beside "Næste aktivitet: Intervalpas, 9 km".
    const dashboard = buildCoachDashboard(
      steadyHistory(BURN_REST_DAY),
      BURN_REST_DAY,
      DASHBOARD_WEEKS,
      TEST_RACE_DATE
    );

    expect(dashboard.workout.type).toBe("rest");
    expect(dashboard.nextActivity.type).toBe("rest");
    expect(dashboard.nextActivity.distanceKm).toBe(0);
    expect(dashboard.nextActivity.reason.join(" ")).toContain("hvile");
  });

  it("is JSON-serializable (no Date instances or undefined gaps)", () => {
    const dashboard = buildCoachDashboard(
      steadyHistory(BURN_WEDNESDAY),
      BURN_WEDNESDAY,
      DASHBOARD_WEEKS,
      TEST_RACE_DATE
    );
    const roundTrip = JSON.parse(JSON.stringify(dashboard));
    expect(roundTrip).toEqual(dashboard);
  });
});
