import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressionActivityInput } from "../../lib/training/progression";
import {
  computeProgression,
  computeSnapshot,
  getCurrentProgression,
  getProgression,
} from "../../lib/training/progression";
import type { HrZone } from "../../types/domain";

vi.mock("../../lib/db/queries", () => ({
  getActivities: vi.fn(),
}));

import { getActivities } from "../../lib/db/queries";

/** Fixed "now" so every window boundary is deterministic. */
const AS_OF = new Date("2026-07-01T12:00:00.000Z");

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(AS_OF.getTime() - days * DAY_MS);
}

type RunOptions = {
  daysAgo: number;
  km?: number;
  minutes?: number;
  hr?: number | null;
  hrZones?: HrZone[] | null;
  type?: string;
};

/** Build a mock activity. Defaults: 10 km easy run in 60 min at 145 bpm. */
function run(options: RunOptions): ProgressionActivityInput {
  const { km = 10, minutes = 60, hr = 145, hrZones = null, type = "Run" } = options;
  return {
    type,
    distance: km * 1000,
    movingTime: minutes * 60,
    averageHeartrate: hr,
    hrZones,
    startDate: daysAgo(options.daysAgo),
  };
}

/** A steady base: one identical run per week covering the full 28-day window. */
function steadyBase(): ProgressionActivityInput[] {
  return [0, 3, 7, 10, 14, 17, 21, 24, 28].map((d) => run({ daysAgo: d }));
}

function zone2Buckets(z2Seconds: number, z3Seconds: number): HrZone[] {
  return [
    { zone: 2, min: 114, max: 133, seconds: z2Seconds },
    { zone: 3, min: 133, max: 152, seconds: z3Seconds },
  ];
}

describe("computeSnapshot — window & filtering", () => {
  it("ignores non-running activities entirely", () => {
    const withRide = [...steadyBase(), run({ daysAgo: 1, km: 100, type: "Ride" })];
    const runsOnly = steadyBase();
    expect(computeSnapshot(withRide, AS_OF).volumeKm).toBe(
      computeSnapshot(runsOnly, AS_OF).volumeKm
    );
  });

  it("includes trail and virtual runs", () => {
    const activities = [
      ...steadyBase(),
      run({ daysAgo: 1, km: 5, type: "TrailRun" }),
      run({ daysAgo: 2, km: 5, type: "VirtualRun" }),
    ];
    const base = computeSnapshot(steadyBase(), AS_OF).volumeKm ?? 0;
    expect(computeSnapshot(activities, AS_OF).volumeKm).toBeCloseTo(base + 10, 5);
  });

  it("excludes activities dated after the snapshot", () => {
    const activities = [...steadyBase(), run({ daysAgo: -2, km: 50 })];
    expect(computeSnapshot(activities, AS_OF).volumeKm).toBe(
      computeSnapshot(steadyBase(), AS_OF).volumeKm
    );
  });

  it("excludes activities older than the 4-week window from volume", () => {
    const activities = [...steadyBase(), run({ daysAgo: 40, km: 50 })];
    expect(computeSnapshot(activities, AS_OF).volumeKm).toBe(
      computeSnapshot(steadyBase(), AS_OF).volumeKm
    );
  });

  it("stamps the snapshot with the asOf date", () => {
    expect(computeSnapshot(steadyBase(), AS_OF).date).toEqual(AS_OF);
  });
});

describe("computeSnapshot — insufficient data (<4 weeks)", () => {
  const twoWeeks = [0, 3, 7, 10, 13].map((d) => run({ daysAgo: d }));

  it("flags the window as not full", () => {
    expect(computeSnapshot(twoWeeks, AS_OF).hasFullWindow).toBe(false);
  });

  it("returns null for every trend metric instead of guessing", () => {
    const snapshot = computeSnapshot(twoWeeks, AS_OF);
    expect(snapshot.paceEfficiency).toBeNull();
    expect(snapshot.hrStability).toBeNull();
    expect(snapshot.zone2Percent).toBeNull();
    expect(snapshot.volumeKm).toBeNull();
    expect(snapshot.readyToIncrease).toBeNull();
    expect(snapshot.trainingLoad.chronic).toBeNull();
    expect(snapshot.trainingLoad.ratio).toBeNull();
    expect(snapshot.trainingLoad.risk).toBeNull();
  });

  it("still reports acute load from the available 7 days", () => {
    const snapshot = computeSnapshot(twoWeeks, AS_OF);
    expect(snapshot.trainingLoad.acute).toBeGreaterThan(0);
  });

  it("returns an all-null snapshot for zero activities", () => {
    const snapshot = computeSnapshot([], AS_OF);
    expect(snapshot.hasFullWindow).toBe(false);
    expect(snapshot.trainingLoad.acute).toBe(0);
    expect(snapshot.paceEfficiency).toBeNull();
    expect(snapshot.volumeKm).toBeNull();
  });

  it("marks the window full at exactly 28 days of history", () => {
    expect(computeSnapshot(steadyBase(), AS_OF).hasFullWindow).toBe(true);
  });
});

describe("computeSnapshot — pace efficiency", () => {
  it("computes speed-per-heartbeat for uniform runs", () => {
    // 10 km in 60 min = 2.778 m/s at 145 bpm → (2.7778 / 145) * 1000 ≈ 19.157
    const snapshot = computeSnapshot(steadyBase(), AS_OF);
    expect(snapshot.paceEfficiency).toBeCloseTo((10000 / 3600 / 145) * 1000, 2);
  });

  it("is null when no activity in the window has heart rate", () => {
    const noHr = [0, 7, 14, 21, 28].map((d) => run({ daysAgo: d, hr: null }));
    expect(computeSnapshot(noHr, AS_OF).paceEfficiency).toBeNull();
  });

  it("skips HR-less runs but keeps the ones with HR", () => {
    const mixed = [...steadyBase(), run({ daysAgo: 1, hr: null })];
    expect(computeSnapshot(mixed, AS_OF).paceEfficiency).toBeCloseTo(
      (10000 / 3600 / 145) * 1000,
      2
    );
  });

  it("resists a single outlier by using the median", () => {
    // One absurd GPS-glitch run (30 km in 30 min) must not move the median.
    const withOutlier = [...steadyBase(), run({ daysAgo: 1, km: 30, minutes: 30 })];
    expect(computeSnapshot(withOutlier, AS_OF).paceEfficiency).toBeCloseTo(
      (10000 / 3600 / 145) * 1000,
      2
    );
  });
});

describe("computeSnapshot — HR drift stability", () => {
  it("is null with fewer than two long runs in the window", () => {
    const shortRuns = [0, 3, 7, 14, 21, 28].map((d) => run({ daysAgo: d, km: 8 }));
    expect(computeSnapshot(shortRuns, AS_OF).hrStability).toBeNull();
  });

  it("scores 100 when HR-per-pace is identical across long runs", () => {
    const longRuns = [
      ...steadyBase(),
      run({ daysAgo: 2, km: 15, minutes: 90, hr: 150 }),
      run({ daysAgo: 9, km: 15, minutes: 90, hr: 150 }),
      run({ daysAgo: 16, km: 15, minutes: 90, hr: 150 }),
    ];
    expect(computeSnapshot(longRuns, AS_OF).hrStability).toBe(100);
  });

  it("scores lower when HR wanders at the same pace", () => {
    const stable = [
      ...steadyBase(),
      run({ daysAgo: 2, km: 15, minutes: 90, hr: 150 }),
      run({ daysAgo: 9, km: 15, minutes: 90, hr: 150 }),
    ];
    const drifting = [
      ...steadyBase(),
      run({ daysAgo: 2, km: 15, minutes: 90, hr: 175 }),
      run({ daysAgo: 9, km: 15, minutes: 90, hr: 140 }),
    ];
    const stableScore = computeSnapshot(stable, AS_OF).hrStability ?? 0;
    const driftScore = computeSnapshot(drifting, AS_OF).hrStability ?? 0;
    expect(driftScore).toBeLessThan(stableScore);
  });

  it("ignores long runs without heart rate", () => {
    const activities = [
      ...steadyBase(),
      run({ daysAgo: 2, km: 15, minutes: 90, hr: null }),
      run({ daysAgo: 9, km: 15, minutes: 90, hr: null }),
    ];
    expect(computeSnapshot(activities, AS_OF).hrStability).toBeNull();
  });
});

describe("computeSnapshot — training load", () => {
  it("reports a ~1.0 ratio for a perfectly steady schedule", () => {
    // One run per week: acute (7d avg) ≈ chronic (28d avg).
    const weekly = [1, 8, 15, 22, 29].map((d) => run({ daysAgo: d }));
    const { ratio } = computeSnapshot(weekly, AS_OF).trainingLoad;
    expect(ratio).not.toBeNull();
    expect(ratio ?? 0).toBeGreaterThan(0.7);
    expect(ratio ?? 0).toBeLessThan(1.3);
  });

  it("classifies a steady schedule as optimal", () => {
    const weekly = [1, 8, 15, 22, 29].map((d) => run({ daysAgo: d }));
    expect(computeSnapshot(weekly, AS_OF).trainingLoad.risk).toBe("optimal");
  });

  it("flags a sudden volume spike as high risk", () => {
    const spike = [
      run({ daysAgo: 1, minutes: 120 }),
      run({ daysAgo: 2, minutes: 120 }),
      run({ daysAgo: 3, minutes: 120 }),
      run({ daysAgo: 4, minutes: 120 }),
      run({ daysAgo: 15, minutes: 30 }),
      run({ daysAgo: 22, minutes: 30 }),
      run({ daysAgo: 28, minutes: 30 }),
    ];
    const { ratio, risk } = computeSnapshot(spike, AS_OF).trainingLoad;
    expect(ratio ?? 0).toBeGreaterThan(1.5);
    expect(risk).toBe("high");
  });

  it("flags a near-total stop as detraining", () => {
    const stopped = [
      run({ daysAgo: 10, minutes: 60 }),
      run({ daysAgo: 14, minutes: 60 }),
      run({ daysAgo: 18, minutes: 60 }),
      run({ daysAgo: 22, minutes: 60 }),
      run({ daysAgo: 26, minutes: 60 }),
      run({ daysAgo: 28, minutes: 60 }),
    ];
    const { ratio, risk } = computeSnapshot(stopped, AS_OF).trainingLoad;
    expect(ratio).toBe(0);
    expect(risk).toBe("detraining");
  });

  it("computes acute load as average daily minutes over 7 days", () => {
    // 70 min of running in the last 7 days → 10 min/day.
    const activities = [
      run({ daysAgo: 1, minutes: 40 }),
      run({ daysAgo: 5, minutes: 30 }),
      run({ daysAgo: 28, minutes: 60 }),
    ];
    expect(computeSnapshot(activities, AS_OF).trainingLoad.acute).toBeCloseTo(10, 5);
  });
});

describe("computeSnapshot — zone shift", () => {
  it("computes zone 2 share from hrZones buckets", () => {
    const activities = [0, 7, 14, 21, 28].map((d) =>
      run({ daysAgo: d, hrZones: zone2Buckets(1800, 1800) })
    );
    expect(computeSnapshot(activities, AS_OF).zone2Percent).toBeCloseTo(50, 5);
  });

  it("falls back to average HR when buckets are missing", () => {
    // 125 bpm of a 190 max ≈ 66 % → all moving time lands in zone 2.
    const activities = [0, 7, 14, 21, 28].map((d) => run({ daysAgo: d, hr: 125 }));
    expect(computeSnapshot(activities, AS_OF).zone2Percent).toBeCloseTo(100, 5);
  });

  it("is null when the window has no HR signal at all", () => {
    const activities = [0, 7, 14, 21, 28].map((d) => run({ daysAgo: d, hr: null }));
    expect(computeSnapshot(activities, AS_OF).zone2Percent).toBeNull();
  });
});

describe("computeSnapshot — volume & readiness", () => {
  it("sums the rolling 4-week distance in km", () => {
    expect(computeSnapshot(steadyBase(), AS_OF).volumeKm).toBeCloseTo(90, 5);
  });

  it("is ready to increase on a steady, balanced load", () => {
    const weekly = [1, 8, 15, 22, 29].map((d) => run({ daysAgo: d }));
    expect(computeSnapshot(weekly, AS_OF).readyToIncrease).toBe(true);
  });

  it("is not ready to increase mid-spike", () => {
    const spike = [
      run({ daysAgo: 1, minutes: 120 }),
      run({ daysAgo: 2, minutes: 120 }),
      run({ daysAgo: 3, minutes: 120 }),
      run({ daysAgo: 4, minutes: 120 }),
      run({ daysAgo: 15, minutes: 30 }),
      run({ daysAgo: 22, minutes: 30 }),
      run({ daysAgo: 28, minutes: 30 }),
    ];
    expect(computeSnapshot(spike, AS_OF).readyToIncrease).toBe(false);
  });
});

describe("computeProgression — time series", () => {
  const history = Array.from({ length: 12 }, (_, week) =>
    [1, 3, 5].map((d) => run({ daysAgo: week * 7 + d }))
  ).flat();

  it("returns one snapshot per requested week", () => {
    expect(computeProgression(history, 8, AS_OF)).toHaveLength(8);
  });

  it("orders snapshots oldest → newest, ending at asOf", () => {
    const series = computeProgression(history, 6, AS_OF);
    expect(series.at(-1)?.date).toEqual(AS_OF);
    for (let i = 1; i < series.length; i++) {
      const gap = series[i].date.getTime() - series[i - 1].date.getTime();
      expect(gap).toBe(7 * DAY_MS);
    }
  });

  it("marks early snapshots without 4 weeks of history as partial", () => {
    // History spans 12 weeks; a snapshot 11 weeks back has <4 weeks behind it.
    const series = computeProgression(history, 12, AS_OF);
    expect(series[0].hasFullWindow).toBe(false);
    expect(series.at(-1)?.hasFullWindow).toBe(true);
  });
});

describe("getProgression / getCurrentProgression", () => {
  const rows = [
    ...steadyBase(),
    run({ daysAgo: 1, km: 200, type: "Ride" }), // must be filtered out
  ].map((activity, i) => ({ id: `a${i}`, ...activity }));

  beforeEach(() => {
    vi.mocked(getActivities).mockReset();
    vi.mocked(getActivities).mockResolvedValue(rows as never);
    // getCurrentProgression reads the real clock; pin it to AS_OF so the
    // fixtures' acute window can't drift out from under the test over time.
    vi.useFakeTimers();
    vi.setSystemTime(AS_OF);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getProgression queries activities for the user and returns the series", async () => {
    const series = await getProgression("user-1", 4);
    expect(getActivities).toHaveBeenCalledWith("user-1", expect.anything());
    expect(series).toHaveLength(4);
  });

  it("getProgression excludes non-running activities", async () => {
    const series = await getProgression("user-1", 1);
    // The 200 km ride would dwarf the ~90 km of runs if it leaked through.
    expect(series.at(-1)?.volumeKm ?? 0).toBeLessThan(150);
  });

  it("getCurrentProgression returns a single snapshot", async () => {
    const snapshot = await getCurrentProgression("user-1");
    expect(snapshot.date).toBeInstanceOf(Date);
    expect(snapshot.trainingLoad.acute).toBeGreaterThan(0);
  });
});
