import { describe, expect, it } from "vitest";
import type { CoachActivityInput } from "@/lib/coach/dashboard";
import { buildPhases, getPhaseRules, type PhaseKey, ZONE2_CEILING_BPM } from "@/lib/coach/engine";
import {
  avoidPlanDuplicate,
  buildNextActivity,
  REDUCED_VARIETY_PACE_RANGES,
  VARIETY_PACE_RANGES,
} from "@/lib/coach/next-activity";
import { PACE_RANGES, type RecommendedType, TEMPO_HR_CAP_BPM } from "@/lib/coach/recommender";
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

function build(
  activities: CoachActivityInput[],
  now: Date,
  ratio: number | null = READY_RATIO,
  todayType?: RecommendedType
) {
  return buildNextActivity({
    activities,
    progression: snapshot(ratio),
    now,
    raceDate: TEST_RACE_DATE,
    todayType,
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

  it("makes the fartlek the default variety when the mix already holds speed and a long run", () => {
    // #254: a covered mix used to fall back to a rolig tur, which is exactly what
    // "Næste pas" already prescribes — the two cards read as duplicates.
    const rules = getPhaseRules("sharpen", TEST_RACE_DATE);
    const activities = [
      run(SHARPEN, 72, { averageHeartrate: HARD_HR }),
      run(SHARPEN, 120, { distance: 16_000 }),
      run(SHARPEN, 168),
      run(SHARPEN, 216),
      run(SHARPEN, 264),
    ];
    const next = build(activities, SHARPEN);

    expect(next.type).toBe("fartlek");
    expect(next.distanceKm).toBe(rules.maxDistanceKm);
    expect(next.paceRange).toEqual(VARIETY_PACE_RANGES.fartlek);
    expect(next.reason.join(" ")).toContain("både fart og distance");
    expect(next.reason.join(" ")).toContain("fartlek");
  });

  it("prescribes the base phase's fartlek at reduced intensity rather than skipping it", () => {
    // Burn has no tempo session, and a long run is already in the mix. Since #254
    // the all-steady signal still becomes a fartlek here — just dæmpet.
    const activities = [
      run(BURN, 72, { distance: 16_000 }),
      ...fiveEasyRuns(BURN, 120).slice(0, 4),
    ];
    const next = build(activities, BURN);

    expect(next.type).toBe("fartlek");
    expect(next.paceRange).toEqual(REDUCED_VARIETY_PACE_RANGES.fartlek);
    expect(next.paceRange).not.toEqual(VARIETY_PACE_RANGES.fartlek);
    expect(next.heartRateCap).toBe(TEMPO_HR_CAP_BPM);
    expect(next.reason.join(" ")).toContain("uden fulde Zone 4–5-blokke");
  });

  it("prescribes the base phase's intervals at reduced intensity with a tempo HR cap", () => {
    const activities = [
      run(BURN, 72, { averageHeartrate: TEMPO_HR }),
      run(BURN, 120, { distance: 16_000 }),
      run(BURN, 168),
      run(BURN, 216),
      run(BURN, 264),
    ];
    const next = build(activities, BURN);

    expect(next.type).toBe("intervals");
    expect(next.paceRange).toEqual(REDUCED_VARIETY_PACE_RANGES.intervals);
    // The reps must not reach Zone 4–5 in a Zone 2 block, so they carry a cap.
    expect(next.heartRateCap).toBe(TEMPO_HR_CAP_BPM);
    expect(next.reason.join(" ")).toContain("uden fulde Zone 4–5-blokke");
  });

  it("downgrades the variation to easy when readiness is only moderate", () => {
    const next = build(fiveEasyRuns(SHARPEN), SHARPEN, EASY_BAND_RATIO);

    expect(next.type).toBe("easy");
    expect(next.reason.join(" ")).toContain("Hold det roligt");
  });

  it("lets the fartlek fire on the 24 h buffer alone, without waiting for 48 h", () => {
    // Newest run 30 h ago: past the easy buffer, short of the interval one — and
    // it is the long run, so the long-Zone-2 branch can't fire either. A fartlek
    // is not a hard intervalpas, so 24 h is enough (#254).
    const activities = [
      run(SHARPEN, 30, { distance: 16_000 }),
      run(SHARPEN, 78),
      run(SHARPEN, 126),
      run(SHARPEN, 174),
      run(SHARPEN, 222),
    ];
    const next = build(activities, SHARPEN);

    expect(next.type).toBe("fartlek");
    expect(next.paceRange).toEqual(VARIETY_PACE_RANGES.fartlek);
  });

  it("lets the fartlek fire on the 24 h buffer in a base phase too, at reduced intensity", () => {
    const activities = [
      run(BURN, 30, { distance: 16_000 }),
      run(BURN, 78),
      run(BURN, 126),
      run(BURN, 174),
      run(BURN, 222),
    ];
    const next = build(activities, BURN);

    expect(next.type).toBe("fartlek");
    expect(next.paceRange).toEqual(REDUCED_VARIETY_PACE_RANGES.fartlek);
    expect(next.reason.join(" ")).toContain("roligere");
  });

  it("still holds intervals back until the full 48 h have passed", () => {
    // Tempo in the mix, no real speed, long run covered — the interval branch's
    // trigger — but only 30 h since the last run. Intervals keep the 48 h gate,
    // so the variation drops to the fartlek that only needs 24 h.
    const activities = [
      run(SHARPEN, 30, { averageHeartrate: TEMPO_HR }),
      run(SHARPEN, 78, { distance: 16_000 }),
      run(SHARPEN, 126),
      run(SHARPEN, 174),
      run(SHARPEN, 222),
    ];
    const next = build(activities, SHARPEN);

    expect(next.type).not.toBe("intervals");
    expect(next.type).toBe("fartlek");
    expect(next.reason.join(" ")).toContain("48 timer et intervalpas kræver");
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

// Issue #273: a run earlier today must be named, not folded into a generic
// "kun N timer" hvile note — the card has to tell the same story the coach
// opener and the Hjem hero tell about the same-day run.
describe("buildNextActivity — same-day run in the rest reason (issue #273)", () => {
  it("names the same-day run when the 24 h buffer is broken by a run earlier today", () => {
    // 10 h before the 12:00 anchor — the same local calendar day as `now`.
    const activities = [run(SHARPEN, 10), ...fiveEasyRuns(SHARPEN)];
    const next = build(activities, SHARPEN);

    expect(next.type).toBe("rest");
    expect(next.reason.join(" ")).toContain("Du har løbet i dag — hviledag for restitution");
    expect(next.reason.join(" ")).toContain("Kun 10 timer siden turen");
  });

  it("keeps the generic note when the newest run was yesterday, still inside 24 h", () => {
    // 20 h before the 12:00 anchor — yesterday afternoon, a different calendar
    // day, so "i dag" would be wrong even though the buffer still blocks.
    const activities = [run(SHARPEN, 20), ...fiveEasyRuns(SHARPEN)];
    const next = build(activities, SHARPEN);

    expect(next.type).toBe("rest");
    expect(next.reason.join(" ")).toContain("Kun 20 timer siden sidste tur");
    expect(next.reason.join(" ")).not.toContain("Du har løbet i dag");
  });
});

// Issue #255: the variation must never name the session today's "Næste pas"
// already prescribes. The two vocabularies overlap on `easy` and `long` only,
// so those are the only collisions these tests can provoke.
describe("buildNextActivity — coordination with today's Næste pas", () => {
  it("shifts the long tur to a fast variation when the plan already prescribes it", () => {
    const rules = getPhaseRules("sharpen", TEST_RACE_DATE);
    // No long run in the mix, so the variation's natural pick is the long tur —
    // exactly what the plan schedules today.
    const next = build(fiveEasyRuns(SHARPEN), SHARPEN, READY_RATIO, "long");

    expect(next.type).not.toBe("long");
    expect(next.type).toBe("intervals");
    expect(next.distanceKm).toBe((rules.minDistanceKm + rules.maxDistanceKm) / 2);
    expect(next.paceRange).toEqual(VARIETY_PACE_RANGES.intervals);
    expect(next.reason.join(" ")).toContain("de to kort skal ikke sige det samme");
  });

  it("falls back to the fartlek when the interval buffer blocks the shifted session", () => {
    // Same collision, but only 30 h since the last run: intervals keep their
    // 48 h gate, so the de-dup lands on the fartlek that clears on 24 h (#254).
    const next = build(fiveEasyRuns(SHARPEN, 30), SHARPEN, READY_RATIO, "long");

    expect(next.type).toBe("fartlek");
    expect(next.paceRange).toEqual(VARIETY_PACE_RANGES.fartlek);
  });

  it("leaves the variation alone when the plan prescribes a tempo — no overlap possible", () => {
    const rules = getPhaseRules("sharpen", TEST_RACE_DATE);
    const next = build(fiveEasyRuns(SHARPEN), SHARPEN, READY_RATIO, "tempo");

    expect(next.type).toBe("long");
    expect(next.distanceKm).toBe(rules.longRunMaxKm);
    expect(next.reason.join(" ")).not.toContain("de to kort skal ikke sige det samme");
  });

  it("keeps safety ahead of de-dup: a broken recovery buffer still means hvile", () => {
    const activities = [run(SHARPEN, 10), ...fiveEasyRuns(SHARPEN)];
    const next = build(activities, SHARPEN, READY_RATIO, "long");

    expect(next.type).toBe("rest");
  });

  it("keeps safety ahead of de-dup: readiness in the rest band still means hvile", () => {
    const next = build(fiveEasyRuns(SHARPEN), SHARPEN, REST_BAND_RATIO, "long");

    expect(next.type).toBe("rest");
  });

  // Issue #260: the plan rests for reasons this card cannot see (planned
  // hviledag, the recommender's recovery buffer, a spent weekly volume budget),
  // and a run beside "Næste pas: Hvile" is a contradiction, not a variation.
  it("rests when today's pas is hvile, however healthy the mix looks", () => {
    // Ready readiness, 24 h+ clear and no long tur in the mix: on any other day
    // this is the long Zone 2-tur.
    const withoutPlan = build(fiveEasyRuns(SHARPEN), SHARPEN, READY_RATIO);
    expect(withoutPlan.type).toBe("long");

    const next = build(fiveEasyRuns(SHARPEN), SHARPEN, READY_RATIO, "rest");

    expect(next.type).toBe("rest");
    expect(next.distanceKm).toBe(0);
    expect(next.paceRange).toEqual({ min: "–", max: "–" });
    expect(next.heartRateCap).toBeNull();
    expect(next.basis).toBe("Sidste 5 ture: 5 rolige · 0 kvalitet · 0 lange");
    expect(next.reason.join(" ")).toContain("hvile");
  });

  it("rests on a hviledag even when readiness only asks for a rolig tur", () => {
    // The readiness "easy" band prescribes a run of its own, so the hvile gate
    // has to outrank it — otherwise a rolig tur lands next to "Næste pas: Hvile".
    const capped = build(fiveEasyRuns(SHARPEN), SHARPEN, EASY_BAND_RATIO);
    expect(capped.type).toBe("easy");

    const next = build(fiveEasyRuns(SHARPEN), SHARPEN, EASY_BAND_RATIO, "rest");
    expect(next.type).toBe("rest");
  });

  it("rests on a hviledag in a base phase too", () => {
    const next = build(fiveEasyRuns(BURN), BURN, READY_RATIO, "rest");

    expect(next.type).toBe("rest");
    expect(next.reason.join(" ")).not.toContain("Zone 4–5-blokke");
  });

  it("keeps the readiness-capped rolig tur even when the plan is also a rolig tur", () => {
    // The one allowed same-type day besides hvile: at moderate readiness the only
    // safe session is a rolig Zone 2-tur, and a longer or faster "variation"
    // would contradict the readiness band both cards read.
    const next = build(fiveEasyRuns(SHARPEN), SHARPEN, EASY_BAND_RATIO, "easy");

    expect(next.type).toBe("easy");
    expect(next.reason.join(" ")).toContain("Hold det roligt");
  });

  it("still applies the base phase's reduced intensity to the shifted session", () => {
    const next = build(fiveEasyRuns(BURN), BURN, READY_RATIO, "long");

    expect(next.type).toBe("intervals");
    expect(next.paceRange).toEqual(REDUCED_VARIETY_PACE_RANGES.intervals);
    expect(next.paceRange).not.toEqual(VARIETY_PACE_RANGES.intervals);
    expect(next.heartRateCap).toBe(TEMPO_HR_CAP_BPM);
    expect(next.reason.join(" ")).toContain("uden fulde Zone 4–5-blokke");
  });

  it("stays deterministic once the pas is part of the input", () => {
    const activities = fiveEasyRuns(SHARPEN);
    const first = build(activities, SHARPEN, READY_RATIO, "long");
    const second = build([...activities].reverse(), SHARPEN, READY_RATIO, "long");

    expect(second).toEqual(first);
  });
});

describe("avoidPlanDuplicate", () => {
  const CLEAR = { longCount: 0, hardCount: 0, intervalBufferClear: true };

  it("leaves a variation the plan does not prescribe untouched", () => {
    expect(avoidPlanDuplicate("long", "tempo", CLEAR)).toBe("long");
    expect(avoidPlanDuplicate("fartlek", "easy", CLEAR)).toBe("fartlek");
    expect(avoidPlanDuplicate("intervals", "long", CLEAR)).toBe("intervals");
  });

  it("leaves a hviledag to the gate upstream — a run type can never collide with it", () => {
    // #260 answers `todayType === "rest"` before the mix is read, so this
    // function only ever sees run types and passes them straight through.
    expect(avoidPlanDuplicate("long", "rest", CLEAR)).toBe("long");
    expect(avoidPlanDuplicate("easy", "rest", CLEAR)).toBe("easy");
  });

  it("leaves everything untouched when no pas is passed in", () => {
    expect(avoidPlanDuplicate("long", undefined, CLEAR)).toBe("long");
    expect(avoidPlanDuplicate("easy", undefined, CLEAR)).toBe("easy");
  });

  it("shifts a duplicated long tur to the fast variation the buffer allows", () => {
    expect(avoidPlanDuplicate("long", "long", CLEAR)).toBe("intervals");
    expect(avoidPlanDuplicate("long", "long", { ...CLEAR, intervalBufferClear: false })).toBe(
      "fartlek"
    );
    expect(avoidPlanDuplicate("long", "long", { ...CLEAR, hardCount: 1 })).toBe("fartlek");
  });

  it("shifts a duplicated rolig tur to the long tur, or to speed when one is covered", () => {
    expect(avoidPlanDuplicate("easy", "easy", CLEAR)).toBe("long");
    expect(avoidPlanDuplicate("easy", "easy", { ...CLEAR, longCount: 1 })).toBe("intervals");
    expect(
      avoidPlanDuplicate("easy", "easy", { ...CLEAR, longCount: 1, intervalBufferClear: false })
    ).toBe("fartlek");
  });
});
