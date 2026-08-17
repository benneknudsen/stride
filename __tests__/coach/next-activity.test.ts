import { describe, expect, it } from "vitest";
import type { CoachActivityInput } from "@/lib/coach/dashboard";
import { buildPhases, getPhaseRules, type PhaseKey, ZONE2_CEILING_BPM } from "@/lib/coach/engine";
import { buildNextActivity, VARIETY_PACE_RANGES } from "@/lib/coach/next-activity";
import { PACE_RANGES, TEMPO_HR_CAP_BPM } from "@/lib/coach/recommender";
import type { ProgressionSnapshot } from "@/lib/training/progression";

const HOUR_MS = 3_600_000;

// Anchored on a pinned race like the rest of the coach suite (issue #99), never
// on calendar literals — the phase is what decides distances and whether a tempo
// session is even allowed.
const TEST_RACE_DATE = new Date(2026, 8, 20);

/** Midday, three days into a phase — far enough from both boundaries that the
 *  engine's Europe/Copenhagen day read can't tip it into the neighbouring block. */
function midPhase(phase: PhaseKey): Date {
  const start = buildPhases(TEST_RACE_DATE)[phase].startDate;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 3, 12, 0);
}

// sharpen allows a tempo session (hasTempoSession); burn is a Zone-2 base block.
const SHARPEN = midPhase("sharpen");
const BURN = midPhase("burn");

// Zone floors at the default 190 bpm max HR: Z2 114–132, Z3 133–151, Z4 152–170.
const EASY_HR = 125;
const TEMPO_HR = 140;
const HARD_HR = 160;

/** A run `hoursAgo` before `asOf`; hrZones omitted like the demo fixtures. */
function run(
  asOf: Date,
  hoursAgo: number,
  overrides: Partial<CoachActivityInput> = {}
): CoachActivityInput {
  return {
    type: "Run",
    distance: 8_000,
    movingTime: 2_700,
    averageHeartrate: EASY_HR,
    startDate: new Date(asOf.getTime() - hoursAgo * HOUR_MS),
    ...overrides,
  };
}

/** Five easy Zone-2 runs, the newest `oldestHoursAgo`-spaced back from `asOf`. */
function fiveEasyRuns(asOf: Date, newestHoursAgo = 72): CoachActivityInput[] {
  return [0, 1, 2, 3, 4].map((i) => run(asOf, newestHoursAgo + i * 48));
}

function snapshot(ratio: number | null): ProgressionSnapshot {
  return {
    date: SHARPEN,
    hasFullWindow: true,
    paceEfficiency: 4.2,
    hrStability: 85,
    trainingLoad: { acute: 30, chronic: 30, ratio, risk: "optimal" },
    zone2Percent: 90,
    volumeKm: 120,
    readyToIncrease: false,
  };
}

// readinessFromRatio bands: ≥80% "ready", ≥68% "easy", else "rest".
const READY_RATIO = 1.0;
const EASY_BAND_RATIO = 1.6;
const REST_BAND_RATIO = 1.9;

function build(activities: CoachActivityInput[], now: Date, ratio: number | null = READY_RATIO) {
  return buildNextActivity({
    activities,
    progression: snapshot(ratio),
    now,
    raceDate: TEST_RACE_DATE,
  });
}

describe("buildNextActivity", () => {
  it("recommends rest when the 24 h recovery buffer is broken", () => {
    const activities = [run(SHARPEN, 10), ...fiveEasyRuns(SHARPEN)];
    const next = build(activities, SHARPEN);

    expect(next.type).toBe("rest");
    expect(next.distanceKm).toBe(0);
    expect(next.heartRateCap).toBeNull();
    expect(next.reason[0]).toContain("restitution");
  });

  it("recommends rest when readiness is in the rest band", () => {
    const next = build(fiveEasyRuns(SHARPEN), SHARPEN, REST_BAND_RATIO);

    expect(next.type).toBe("rest");
    expect(next.reason.join(" ")).toContain("readiness");
  });

  it("suggests a long Zone 2 run when none of the last five was long", () => {
    const rules = getPhaseRules("sharpen", TEST_RACE_DATE);
    const next = build(fiveEasyRuns(SHARPEN), SHARPEN);

    expect(next.type).toBe("long");
    expect(next.distanceKm).toBe(rules.longRunMaxKm);
    expect(next.paceRange).toEqual(PACE_RANGES.long);
    expect(next.heartRateCap).toBe(ZONE2_CEILING_BPM);
    expect(next.basis).toBe("Sidste 5 ture: 5 rolige · 0 kvalitet · 0 lange");
  });

  it("suggests a fartlek when the mix is all steady and the long run is covered", () => {
    const rules = getPhaseRules("sharpen", TEST_RACE_DATE);
    const activities = [
      run(SHARPEN, 72, { distance: 16_000 }),
      run(SHARPEN, 120),
      run(SHARPEN, 168),
      run(SHARPEN, 216),
      run(SHARPEN, 264),
    ];
    const next = build(activities, SHARPEN);

    expect(next.type).toBe("fartlek");
    expect(next.distanceKm).toBe(rules.maxDistanceKm);
    expect(next.paceRange).toEqual(VARIETY_PACE_RANGES.fartlek);
    expect(next.heartRateCap).toBe(TEMPO_HR_CAP_BPM);
    expect(next.basis).toBe("Sidste 5 ture: 4 rolige · 0 kvalitet · 1 lange");
    expect(next.reason.join(" ")).toContain("fartlek");
  });

  it("suggests intervals when the mix holds tempo but no real speed", () => {
    const rules = getPhaseRules("sharpen", TEST_RACE_DATE);
    const activities = [
      run(SHARPEN, 72, { averageHeartrate: TEMPO_HR }),
      run(SHARPEN, 120, { distance: 16_000 }),
      run(SHARPEN, 168),
      run(SHARPEN, 216),
      run(SHARPEN, 264),
    ];
    const next = build(activities, SHARPEN);

    expect(next.type).toBe("intervals");
    expect(next.distanceKm).toBe((rules.minDistanceKm + rules.maxDistanceKm) / 2);
    expect(next.paceRange).toEqual(VARIETY_PACE_RANGES.intervals);
    // Reps are meant to reach Zone 4–5, so the card carries no HR ceiling.
    expect(next.heartRateCap).toBeNull();
  });

  it("falls back to a rolig tur when the mix already holds speed and a long run", () => {
    const rules = getPhaseRules("sharpen", TEST_RACE_DATE);
    const activities = [
      run(SHARPEN, 72, { averageHeartrate: HARD_HR }),
      run(SHARPEN, 120, { distance: 16_000 }),
      run(SHARPEN, 168),
      run(SHARPEN, 216),
      run(SHARPEN, 264),
    ];
    const next = build(activities, SHARPEN);

    expect(next.type).toBe("easy");
    expect(next.distanceKm).toBe((rules.minDistanceKm + rules.maxDistanceKm) / 2);
    expect(next.paceRange).toEqual(PACE_RANGES.easy);
    expect(next.reason.join(" ")).toContain("både fart og distance");
  });

  it("keeps a Zone-2 base phase easy instead of prescribing the speed it disallows", () => {
    // Burn has no tempo session, and a long run is already in the mix — so the
    // all-steady signal can't become fartlek/interval work here.
    const activities = [
      run(BURN, 72, { distance: 16_000 }),
      ...fiveEasyRuns(BURN, 120).slice(0, 4),
    ];
    const next = build(activities, BURN);

    expect(next.type).toBe("easy");
    expect(next.reason.join(" ")).toContain("Zone 2");
  });

  it("downgrades the variation to easy when readiness is only moderate", () => {
    const next = build(fiveEasyRuns(SHARPEN), SHARPEN, EASY_BAND_RATIO);

    expect(next.type).toBe("easy");
    expect(next.reason.join(" ")).toContain("Hold det roligt");
  });

  it("downgrades a fast variation to easy when only the 24 h buffer has passed, not 48 h", () => {
    // Newest run 30 h ago: past the easy buffer, short of the quality one — and
    // it is the long run, so the long-Zone-2 branch can't fire either.
    const activities = [
      run(SHARPEN, 30, { distance: 16_000 }),
      run(SHARPEN, 78),
      run(SHARPEN, 126),
      run(SHARPEN, 174),
      run(SHARPEN, 222),
    ];
    const next = build(activities, SHARPEN);

    expect(next.type).toBe("easy");
    expect(next.reason.join(" ")).toContain("48");
  });

  it("classifies intensity from Strava's hr_zones buckets when present", () => {
    // Same easy average HR, but the zone buckets say it was threshold work — so
    // the mix reads as five quality sessions and the fartlek rule must not fire;
    // what it is missing is the long tur.
    const activities = fiveEasyRuns(SHARPEN).map((activity) => ({
      ...activity,
      hrZones: [{ zone: 4, min: 152, max: 170, seconds: 2_700 }],
    }));
    const next = build(activities, SHARPEN);

    expect(next.type).toBe("long");
    expect(next.basis).toBe("Sidste 5 ture: 0 rolige · 5 kvalitet · 0 lange");
  });

  it("starts a runner with no history on an easy run rather than guessing", () => {
    const next = build([], SHARPEN, null);

    expect(next.type).toBe("easy");
    expect(next.basis).toBe("Ingen registrerede ture endnu");
  });

  it("ignores non-run activities and anything dated after `now`", () => {
    const activities = [
      run(SHARPEN, -48, { averageHeartrate: HARD_HR }), // two days in the future
      run(SHARPEN, 12, { type: "Ride", distance: 40_000 }), // not a run
      ...fiveEasyRuns(SHARPEN),
    ];
    const next = build(activities, SHARPEN);

    expect(next.type).toBe("long");
    expect(next.basis).toBe("Sidste 5 ture: 5 rolige · 0 kvalitet · 0 lange");
  });

  it("is deterministic and JSON-serializable for the same input", () => {
    const activities = fiveEasyRuns(SHARPEN);
    const first = build(activities, SHARPEN);
    const second = build([...activities].reverse(), SHARPEN);

    expect(second).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });
});
