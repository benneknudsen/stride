import { describe, expect, it } from "vitest";
import type { CoachDashboardData } from "@/lib/coach/dashboard";
import { buildCoachView, buildLiveCoachView } from "@/lib/cobalt/coach";
import { buildHomeView, type HomeActivityLike, zoneForHeartRate } from "@/lib/cobalt/hjem";
import {
  BAND_NOTES,
  RECOVERY_CAP_PCT,
  readinessFromRatio,
  readinessWithRecovery,
  SAME_DAY_RUN_NOTE,
} from "@/lib/cobalt/readiness";
import { zoneBadgeForHeartRate } from "@/lib/cobalt/zones";
import { demoActivities } from "@/lib/demo/data";
import { hoursSinceHardEffort, hoursSinceLastRun } from "@/lib/training/effort";
import { computeSnapshot, type ProgressionActivityInput } from "@/lib/training/progression-core";
import { zoneForHeartRate as trainingZone } from "@/lib/training/zones";

/**
 * The shared readiness model (issues #126/#127): one function over the
 * acute:chronic load ratio, read by both the Hjem readiness card and the
 * Coach form-status card — so the two pages can never show two different
 * readiness numbers for the same activities and the same clock.
 */

const NOW = new Date(2026, 6, 15, 9, 0);

describe("readinessFromRatio", () => {
  it("holds full marks across the plateau — rested base through mild overload (#241)", () => {
    // Full marks span PLATEAU_LO (0.8) … PLATEAU_HI (1.15): a rested athlete and
    // one a single quality session above the base both read fully ready.
    for (const ratio of [0.8, 1.0, 1.1, 1.15]) {
      expect(readinessFromRatio(ratio)).toEqual({
        pct: 95,
        band: "ready",
        note: "Klar til hårdt pas",
      });
    }
  });

  it("rewards freshness — being rested scores higher than the mirror overload (#241)", () => {
    // The old mapping was symmetric, so 0.8 and 1.2 scored identically. Now the
    // rested side is only gently penalised while the overload side is steep.
    expect(readinessFromRatio(0.8).pct).not.toBe(readinessFromRatio(1.2).pct);
    expect(readinessFromRatio(0.8).pct).toBeGreaterThan(readinessFromRatio(1.2).pct);
    // A genuinely rested athlete still reads high and "ready".
    expect(readinessFromRatio(0.8).pct).toBeGreaterThanOrEqual(90);
    expect(readinessFromRatio(0.8).band).toBe("ready");
  });

  it("no longer punishes one quality run — ratio 1.29 stays high and ready (#241)", () => {
    // The reported "82% after one 10K" case: acute a bit above base.
    const r = readinessFromRatio(1.29);
    expect(r.pct).toBeGreaterThanOrEqual(88);
    expect(r.band).toBe("ready");
  });

  it("still flags a genuine overload as the ratio climbs past the plateau (#241)", () => {
    expect(readinessFromRatio(1.5).pct).toBeLessThan(readinessFromRatio(1.29).pct);
    // 1.5 → clearly off full marks, out of the "ready" band.
    expect(readinessFromRatio(1.5).band).not.toBe("ready");
  });

  it("clamps to the 55–95 band", () => {
    expect(readinessFromRatio(3).pct).toBe(55); // deep overload → floor
    expect(readinessFromRatio(2.0).pct).toBe(55); // slope pinned to the floor at 2.0
    expect(readinessFromRatio(1.001).pct).toBe(95);
    // Even the most detrained athlete stays above the floor — freshness, not risk.
    expect(readinessFromRatio(0).pct).toBeGreaterThan(55);
  });

  it.each([
    [1.0, "ready"],
    [1.15, "ready"], // top of the plateau
    [1.29, "ready"], // the "82% case" now reads ready
    [1.5, "easy"], // 95 − 0.35·47.06 → 79, just under the ready floor
    [1.7, "easy"],
    [2.0, "rest"], // clamped to the floor
    [0.4, "ready"], // rested reads high, never "rest"
  ] as const)("puts ratio %f in the %s band", (ratio, band) => {
    expect(readinessFromRatio(ratio).band).toBe(band);
  });

  it("reads a missing ratio (no chronic base yet) as a neutral easy 72", () => {
    expect(readinessFromRatio(null)).toEqual({
      pct: 72,
      band: "easy",
      note: "Let træning anbefalet",
    });
  });
});

// ---------------------------------------------------------------------------
// Recovery-aware cap (issue #259)
// ---------------------------------------------------------------------------

describe("readinessWithRecovery", () => {
  const ready = readinessFromRatio(1.0); // 95 / ready
  const easy = readinessFromRatio(1.5); // 79 / easy
  const rest = readinessFromRatio(2.0); // 55 / rest

  it("leaves readiness untouched when there is no recent hard effort", () => {
    expect(readinessWithRecovery(ready, null)).toEqual(ready);
    expect(readinessWithRecovery(easy, null)).toEqual(easy);
    expect(readinessWithRecovery(rest, null)).toEqual(rest);
  });

  it("caps to the top of the easy band inside the 48 h window", () => {
    expect(readinessWithRecovery(ready, 1)).toEqual({
      pct: RECOVERY_CAP_PCT,
      band: "easy",
      note: "Let træning anbefalet",
    });
    // The reported case: a hard tur an hour ago, 93 % on the gauge.
    expect(
      readinessWithRecovery({ pct: 93, band: "ready", note: "Klar til hårdt pas" }, 1).note
    ).not.toBe("Klar til hårdt pas");
  });

  it.each([0, 1, 12, 24, 47.9])("still caps %f hours after the hard effort", (hours) => {
    const capped = readinessWithRecovery(ready, hours);
    expect(capped.band).not.toBe("ready");
    expect(capped.pct).toBe(RECOVERY_CAP_PCT);
  });

  it.each([48, 49, 72, 168])("releases the cap %f hours after the hard effort", (hours) => {
    expect(readinessWithRecovery(ready, hours)).toEqual(ready);
  });

  it("is a monotone downgrade — it never raises readiness", () => {
    for (const ratio of [0, 0.4, 0.8, 1.0, 1.15, 1.5, 1.8, 2.5]) {
      const base = readinessFromRatio(ratio);
      const capped = readinessWithRecovery(base, 6);
      expect(capped.pct).toBeLessThanOrEqual(base.pct);
    }
    // A "rest" read is not lifted into "easy" by the cap.
    expect(readinessWithRecovery(rest, 6)).toEqual(rest);
  });

  it("keeps percentage, band and note in agreement after the cap", () => {
    for (const hours of [null, 0, 47, 48, 100]) {
      for (const ratio of [0.5, 1.0, 1.5, 2.0]) {
        const r = readinessWithRecovery(readinessFromRatio(ratio), hours);
        expect(r.note).toBe(BAND_NOTES[r.band]);
        expect(readinessFromRatio(null).band).toBe("easy"); // band thresholds unchanged
        if (r.band === "ready") expect(r.pct).toBeGreaterThanOrEqual(80);
        if (r.band === "easy") expect(r.pct).toBeGreaterThanOrEqual(68);
      }
    }
  });

  it("keeps an underloaded, well-rested week high — freshness is still not penalised (#241)", () => {
    // Ratio 0.72, the issue's own "93 % + FALDENDE" case: underloaded relative
    // to the 42-day base. With no hard effort in the window it stays "ready".
    const base = readinessFromRatio(0.72);
    expect(base.band).toBe("ready");
    expect(readinessWithRecovery(base, null)).toEqual(base);
    expect(readinessWithRecovery(base, 96)).toEqual(base);
  });
});

// ---------------------------------------------------------------------------
// Hjem ↔ Coach agreement (issue #127)
// ---------------------------------------------------------------------------

/** Minimal CoachDashboardData carrying only what buildLiveCoachView reads. */
function dashboard(
  ratio: number | null,
  recentHardHours: number | null = null,
  sinceLastRun: number | null = null
): CoachDashboardData {
  return {
    hoursSinceHardEffort: recentHardHours,
    hoursSinceLastRun: sinceLastRun,
    workout: {
      type: "tempo",
      distanceKm: 10,
      paceRange: { min: "4:25", max: "5:20" },
      heartRateCap: 165,
      reason: ["Tempo bygger tærskel."],
      // biome-ignore lint/suspicious/noExplicitAny: partial view-model fixture
    } as any,
    paceSeries: [],
    zoneSeries: [],
    volumeSeries: [],
    loadGauge: { ratio, fraction: 0.5, risk: null, label: "" },
    // biome-ignore lint/suspicious/noExplicitAny: partial view-model fixture
  } as any;
}

/**
 * Steady running every third day — enough history for a non-null load ratio.
 *
 * `runCount` is a knob because the chronic base is a 42-day EWMA: the default
 * six weeks (14 runs) is long enough to *have* a ratio but not long enough for
 * the base to saturate, so it still reads as an overload. Tests that need the
 * load-only readiness to land in a particular band pass a longer history.
 */
function liveHistory(runCount = 14): HomeActivityLike[] {
  return Array.from({ length: runCount }, (_, i) => {
    const daysAgo = i * 3;
    const startDate = new Date(NOW);
    startDate.setDate(startDate.getDate() - daysAgo);
    startDate.setHours(7, 30, 0, 0);
    return {
      id: `run-${daysAgo}`,
      name: `Tur ${daysAgo}`,
      type: "Run",
      startDate,
      distance: 8_000,
      movingTime: 2_700,
      averageSpeed: 8_000 / 2_700,
      averageHeartrate: 142,
      averageCadence: 88,
      totalElevationGain: 20,
    };
  });
}

describe("Hjem and Coach show the same readiness (issue #127)", () => {
  it("agrees on the demo fixtures", () => {
    const home = buildHomeView(demoActivities, NOW);
    const coach = buildCoachView(NOW);

    expect(home.readinessPct).toBe(coach.form.pct);
    expect(home.readinessNote).toBe(coach.form.note);
  });

  it("agrees on a live history driven through the dashboard's own ratio", () => {
    const activities = liveHistory();
    // The same snapshot the coach dashboard pipeline computes its gauge from.
    const ratio = computeSnapshot(
      activities.map((a) => ({ ...a, hrZones: null })),
      NOW
    ).trainingLoad.ratio;
    expect(ratio).not.toBeNull();

    const home = buildHomeView(activities, NOW);
    const coach = buildLiveCoachView(dashboard(ratio), activities, NOW);

    expect(home.readinessPct).toBe(coach.form.pct);
    expect(home.readinessNote).toBe(coach.form.note);
  });

  it("still agrees once a recent hard effort caps both surfaces (#259)", () => {
    // A long enough history that the chronic base has saturated and the
    // load-only read is comfortably "ready" — otherwise the cap would have
    // nothing to downgrade and the test would pass for the wrong reason.
    // Only the newest run's intensity changes, so the load ratio is *identical*
    // (dailyLoad is moving minutes, no intensity weighting): the cap is the
    // whole difference.
    const activities = liveHistory(28).map((a, i) =>
      i === 0 ? { ...a, averageHeartrate: 178 } : a
    );
    const ratio = computeSnapshot(
      activities.map((a) => ({ ...a, hrZones: null })),
      NOW
    ).trainingLoad.ratio;
    // The newest run started at 07:30 — 1,5 h before NOW, deep inside the 48 h.
    const recentHardHours = hoursSinceHardEffort(activities, NOW);
    expect(recentHardHours).not.toBeNull();
    expect(recentHardHours ?? 0).toBeLessThan(48);

    const home = buildHomeView(activities, NOW);
    const coach = buildLiveCoachView(dashboard(ratio, recentHardHours), activities, NOW);

    expect(home.readinessPct).toBe(coach.form.pct);
    expect(home.readinessNote).toBe(coach.form.note);
    // …and both are capped: no "Klar til hårdt pas" an hour after a hard tur.
    expect(home.readinessPct).toBe(RECOVERY_CAP_PCT);
    expect(home.readinessNote).toBe(BAND_NOTES.easy);
    expect(home.heroNote).toBe("Hold tempoet roligt i dag.");
    // The uncapped load read on its own would still have said "ready".
    expect(readinessFromRatio(ratio).band).toBe("ready");
  });

  it("derives the Hjem readiness from the load ratio, not from heart rate", () => {
    // Same distances/dates, wildly different pulses → identical readiness.
    const calm = buildHomeView(liveHistory(), NOW);
    const strained = buildHomeView(
      liveHistory().map((a) => ({ ...a, averageHeartrate: 185 })),
      NOW
    );
    expect(strained.readinessPct).toBe(calm.readinessPct);
  });
});

// ---------------------------------------------------------------------------
// Same-day run surfaces agree (issue #273)
// ---------------------------------------------------------------------------

// A rolig tur this morning never trips the #259 hard-effort cap, so the load
// read stays "ready" — but the hero and the coach opener must name the run
// instead of promising "Klar til hårdt pas" / "Kroppen er klar i dag.", the
// same story the rest-day cards tell.
describe("same-day run surfaces agree (issue #273)", () => {
  /** The saturated 28-run base, newest run this morning (07:30, NOW 09:00). */
  function morningHistory(): HomeActivityLike[] {
    return liveHistory(28);
  }

  it("hero and opener name the run today instead of claiming ready", () => {
    const activities = morningHistory();
    const ratio = computeSnapshot(
      activities.map((a) => ({ ...a, hrZones: null })),
      NOW
    ).trainingLoad.ratio;
    const sinceLastRun = hoursSinceLastRun(activities, NOW);
    // The fixture must produce exactly the reported situation: load-only read
    // "ready", newest run deep inside the 24 h window, no hard effort in sight.
    expect(ratio).not.toBeNull();
    expect(readinessFromRatio(ratio).band).toBe("ready");
    expect(sinceLastRun ?? 99).toBeLessThan(24);
    expect(hoursSinceHardEffort(activities, NOW)).toBeNull();

    const home = buildHomeView(activities, NOW);
    const coach = buildLiveCoachView(dashboard(ratio, null, sinceLastRun), activities, NOW);

    expect(home.heroNote).toBe(SAME_DAY_RUN_NOTE);
    expect(coach.initialMessages[0].text).toContain(SAME_DAY_RUN_NOTE);
    expect(coach.initialMessages[0].text).not.toContain("klar til hårdt pas");
    // The readiness card itself keeps the load-derived read — the override is
    // hero/opener copy only; the #259 cap stays a hard-effort mechanism.
    expect(home.readinessNote).toBe(BAND_NOTES.ready);
    expect(coach.form.note).toBe(BAND_NOTES.ready);
  });

  it("keeps the ready-band hero once the newest run is outside the 24 h window", () => {
    // Drop this morning's run: the newest is three days old, so nothing
    // overrides the band's own hero note.
    const activities = morningHistory().slice(1);
    const ratio = computeSnapshot(
      activities.map((a) => ({ ...a, hrZones: null })),
      NOW
    ).trainingLoad.ratio;
    const sinceLastRun = hoursSinceLastRun(activities, NOW);
    expect(ratio).not.toBeNull();
    expect(readinessFromRatio(ratio).band).toBe("ready");
    expect(sinceLastRun ?? 0).toBeGreaterThan(24);

    const home = buildHomeView(activities, NOW);
    const coach = buildLiveCoachView(dashboard(ratio, null, sinceLastRun), activities, NOW);

    expect(home.heroNote).toBe("Kroppen er klar i dag.");
    // The opener lowercases the band note.
    expect(coach.initialMessages[0].text).toContain("klar til hårdt pas");
    expect(coach.initialMessages[0].text).not.toContain(SAME_DAY_RUN_NOTE);
  });
});

// ---------------------------------------------------------------------------
// Single recent 10K — the real path, end to end (issue #243)
// ---------------------------------------------------------------------------

describe("readiness from a real training history (issue #243)", () => {
  // Everything here goes through the real engine — computeSnapshot →
  // trainingLoad.ratio → readinessFromRatio — with no hand-picked ratio anywhere,
  // so it exercises the whole "a runner does one 10K on a base" path the
  // isolated readinessFromRatio tests above never touch.

  function run(daysAgo: number, km: number, paceSecPerKm: number): ProgressionActivityInput {
    const startDate = new Date(NOW);
    startDate.setDate(startDate.getDate() - daysAgo);
    startDate.setHours(7, 30, 0, 0);
    return {
      type: "Run",
      distance: km * 1000,
      movingTime: Math.round(km * paceSecPerKm),
      averageHeartrate: 140,
      hrZones: null,
      startDate,
    };
  }

  // A shared, fully warmed aerobic base — 18 weeks of three 8 km easy runs a
  // week (8 km @ 5:00/km ≈ 40 min), all older than a week so the most-recent
  // scenario week stacks cleanly on top. EWMA load (#246) builds from the first
  // activity with a 42-day chronic tau, so the base has to run long enough for
  // the chronic series (CTL) to reach its steady state — a short 4-week base is
  // still warming up from a 0 start, which biases every acute:chronic ratio high
  // (the cold-start the engine's own tests call out). This settled base is what
  // makes the ratios below physiologically meaningful rather than warm-up noise.
  const FOUNDATION: ProgressionActivityInput[] = Array.from({ length: 18 }, (_, week) =>
    [9, 11, 13].map((day) => run(day + week * 7, 8, 300))
  ).flat();

  // One hard 10 km yesterday, on top of a normal 3-run week.
  const withTenK: ProgressionActivityInput[] = [
    ...FOUNDATION,
    ...[2, 4, 6].map((d) => run(d, 8, 300)),
    run(1, 10, 270), // the 10K @ 4:30/km
  ];
  // A light recovery week instead — three shorter easy runs, nothing hard.
  const rested: ProgressionActivityInput[] = [
    ...FOUNDATION,
    ...[2, 4, 6].map((d) => run(d, 7, 300)),
  ];
  // A genuine, sustained overload — not one hard session but ten straight days
  // of 13 km, far above the three-runs-a-week base. Under the smoother EWMA
  // acute a single doubled week barely lifts the ratio (it stays "ready"); it
  // takes a real multi-day surge to push acute well past the chronic base and
  // out of the ready band.
  const overload: ProgressionActivityInput[] = [
    ...FOUNDATION,
    ...Array.from({ length: 10 }, (_, i) => run(i + 1, 13, 270)),
  ];

  function ratioFor(activities: ProgressionActivityInput[]): number {
    const ratio = computeSnapshot(activities, NOW).trainingLoad.ratio;
    if (ratio === null) throw new Error("fixture must have a full chronic window");
    return ratio;
  }

  it("reads one 10K on a 4-week base as ratio > 1 and still 'ready' (#241 mapping)", () => {
    const ratio = ratioFor(withTenK);
    // The 10K nudged the fast acute EWMA a little above the settled chronic base.
    expect(ratio).toBeGreaterThan(1);
    const readiness = readinessFromRatio(ratio);
    // The asymmetric #241 mapping keeps a single quality session high in the ready
    // band — the old "82% after one 10K" complaint now reads in the mid-90s.
    expect(readiness.pct).toBeGreaterThanOrEqual(85);
    expect(readiness.pct).toBeLessThanOrEqual(95);
    expect(readiness.band).toBe("ready");
  });

  it("never penalises freshness — a rested week reads at least as ready as the 10K", () => {
    const restedRatio = ratioFor(rested);
    const tenKRatio = ratioFor(withTenK);
    // A genuine taper: acute load below the chronic base.
    expect(restedRatio).toBeLessThan(1);
    // The whole point of the #241 asymmetry — being fresh is never scored below a
    // mild overload.
    expect(readinessFromRatio(restedRatio).pct).toBeGreaterThanOrEqual(
      readinessFromRatio(tenKRatio).pct
    );
    expect(readinessFromRatio(restedRatio).band).toBe("ready");
  });

  it("flags a sustained overload as clearly less ready than the single 10K", () => {
    const overloadRatio = ratioFor(overload);
    const tenKRatio = ratioFor(withTenK);
    // A multi-day surge, not one hard run — the ratio climbs well past the 10K case.
    expect(overloadRatio).toBeGreaterThan(tenKRatio);
    const overloadReadiness = readinessFromRatio(overloadRatio);
    expect(overloadReadiness.pct).toBeLessThan(readinessFromRatio(tenKRatio).pct);
    // Out of the ready band entirely — an "easy"/"rest" read.
    expect(overloadReadiness.band).not.toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// One zone model behind the badges (issue #129)
// ---------------------------------------------------------------------------

describe("zone badges follow lib/training/zones (issue #129)", () => {
  it.each([
    100, 115, 135, 155, 175, 190,
  ])("badge level equals the training-zone number at %d bpm", (bpm) => {
    expect(zoneForHeartRate(bpm).level).toBe(trainingZone(bpm));
  });

  it("passes the athlete's HR config through to the shared model", () => {
    const config = { maxHr: 200, restingHr: 50 };
    expect(zoneForHeartRate(155, config).level).toBe(trainingZone(155, config));
    // 155 bpm is zone 4 against the 190 default but zone 3 under 200-max Karvonen.
    expect(zoneForHeartRate(155).level).toBe(4);
    expect(zoneForHeartRate(155, config).level).toBe(3);
  });

  it("gives zone 1 its own badge instead of starting at level 2", () => {
    const badge = zoneBadgeForHeartRate(105); // ≈ 55 % of the 190 default max
    expect(badge).toEqual({ level: 1, label: "Restitution", tone: "cobalt" });
  });
});
