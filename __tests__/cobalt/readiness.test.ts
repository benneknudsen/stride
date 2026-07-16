import { describe, expect, it } from "vitest";
import type { CoachDashboardData } from "@/lib/coach/dashboard";
import { buildCoachView, buildLiveCoachView } from "@/lib/cobalt/coach";
import { buildHomeView, type HomeActivityLike, zoneForHeartRate } from "@/lib/cobalt/hjem";
import { readinessFromRatio } from "@/lib/cobalt/readiness";
import { zoneBadgeForHeartRate } from "@/lib/cobalt/zones";
import { demoActivities } from "@/lib/demo/data";
import { computeSnapshot } from "@/lib/training/progression-core";
import { zoneForHeartRate as trainingZone } from "@/lib/training/zones";

/**
 * The shared readiness model (issues #126/#127): one function over the
 * acute:chronic load ratio, read by both the Hjem readiness card and the
 * Coach form-status card — so the two pages can never show two different
 * readiness numbers for the same activities and the same clock.
 */

const NOW = new Date(2026, 6, 15, 9, 0);

describe("readinessFromRatio", () => {
  it("peaks at 95 when the acute load sits exactly on the chronic base", () => {
    expect(readinessFromRatio(1)).toEqual({ pct: 95, band: "ready", note: "Klar til hårdt pas" });
  });

  it("falls symmetrically as the ratio leaves 1 in either direction", () => {
    expect(readinessFromRatio(1.2).pct).toBe(readinessFromRatio(0.8).pct);
    expect(readinessFromRatio(1.2).pct).toBeLessThan(readinessFromRatio(1.1).pct);
  });

  it("clamps to the 55–95 band", () => {
    expect(readinessFromRatio(3).pct).toBe(55);
    expect(readinessFromRatio(0).pct).toBe(55);
    expect(readinessFromRatio(1.001).pct).toBe(95);
  });

  it.each([
    [1.0, "ready"],
    [1.33, "ready"], // 95 − 14.85 → 80, the ready floor
    [1.4, "easy"],
    [1.6, "easy"], // 95 − 27 → 68, the easy floor
    [1.65, "rest"],
    [0.3, "rest"],
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
// Hjem ↔ Coach agreement (issue #127)
// ---------------------------------------------------------------------------

/** Minimal CoachDashboardData carrying only what buildLiveCoachView reads. */
function dashboard(ratio: number | null): CoachDashboardData {
  return {
    workout: {
      type: "tempo",
      distanceKm: 10,
      paceRange: { min: "4:25", max: "5:20" },
      heartRateCap: 165,
      reason: ["Tempo bygger tærskel."],
      // biome-ignore lint/suspicious/noExplicitAny: partial view-model fixture
    } as any,
    weekStrip: [],
    paceSeries: [],
    zoneSeries: [],
    volumeSeries: [],
    loadGauge: { ratio, fraction: 0.5, risk: null, label: "" },
    // biome-ignore lint/suspicious/noExplicitAny: partial view-model fixture
  } as any;
}

/** Six weeks of steady running — enough history for a non-null load ratio. */
function liveHistory(): HomeActivityLike[] {
  return Array.from({ length: 14 }, (_, i) => {
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
