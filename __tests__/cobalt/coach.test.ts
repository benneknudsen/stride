import { describe, expect, it } from "vitest";
import type { CoachDashboardData } from "@/lib/coach/dashboard";
import {
  buildCoachView,
  buildLiveCoachView,
  type CoachLoadActivityLike,
  loadStatusFromRatio,
} from "@/lib/cobalt/coach";

/**
 * Unit tests for the Coach view-model (lib/cobalt/coach.ts).
 *
 * loadStatusFromRatio is pure. buildCoachView reads the demo fixtures and is
 * deterministic given a fixed `now`. buildLiveCoachView is driven by a minimal
 * hand-built CoachDashboardData so the derivations (form %, trend, focus quote,
 * load status) can be asserted without the full dashboard pipeline.
 */

const NOW = new Date(2026, 6, 15, 9, 0);

// ---------------------------------------------------------------------------
// loadStatusFromRatio
// ---------------------------------------------------------------------------

describe("loadStatusFromRatio", () => {
  it("reads a null ratio (no chronic base yet) as OPTIMAL", () => {
    expect(loadStatusFromRatio(null)).toBe("OPTIMAL");
  });

  it.each([
    [0.5, "AFKOBLING"],
    [0.79, "AFKOBLING"],
    [0.8, "OPTIMAL"],
    [1.3, "OPTIMAL"],
    [1.31, "SPÆNDING"],
    [1.5, "SPÆNDING"],
    [1.51, "RISIKO"],
    [2.4, "RISIKO"],
  ] as const)("classifies ratio %f as %s", (ratio, expected) => {
    expect(loadStatusFromRatio(ratio)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// buildCoachView (demo fallback)
// ---------------------------------------------------------------------------

describe("buildCoachView", () => {
  const view = buildCoachView(NOW);

  it("counts every demo activity in the header", () => {
    expect(view.activityCount).toBeGreaterThan(0);
  });

  it("opens with a three-message coach/user/coach transcript", () => {
    expect(view.initialMessages).toHaveLength(3);
    expect(view.initialMessages.map((m) => m.role)).toEqual(["coach", "user", "coach"]);
  });

  it("exposes the three quick-prompt chips", () => {
    expect(view.prompts).toHaveLength(3);
    expect(view.prompts).toContain("Analysér min uge");
  });

  it("builds 14 daily load bars with only the last (today) accented", () => {
    expect(view.load.bars).toHaveLength(14);
    expect(view.load.bars.at(-1)?.accent).toBe(true);
    expect(view.load.bars.slice(0, -1).every((b) => !b.accent)).toBe(true);
  });

  it("keeps every bar fraction honest — 0 to 1, no fabricated floor (issue #128)", () => {
    for (const bar of view.load.bars) {
      expect(bar.fraction).toBeGreaterThanOrEqual(0);
      expect(bar.fraction).toBeLessThanOrEqual(1);
    }
    // The window's peak day always fills the chart.
    expect(Math.max(...view.load.bars.map((b) => b.fraction))).toBe(1);
  });

  it("clamps the readiness percentage to the 55–95 band", () => {
    expect(view.form.pct).toBeGreaterThanOrEqual(55);
    expect(view.form.pct).toBeLessThanOrEqual(95);
  });

  it("produces a valid load status with a matching note", () => {
    expect(["AFKOBLING", "OPTIMAL", "SPÆNDING", "RISIKO"]).toContain(view.load.status);
    expect(view.load.note.length).toBeGreaterThan(0);
  });

  it("uses a red trend tone only when the trend is falling", () => {
    if (view.form.trend === "FALDENDE") {
      expect(view.form.trendTone).toBe("red");
    } else {
      expect(view.form.trendTone).toBe("cobalt");
    }
  });
});

// ---------------------------------------------------------------------------
// buildLiveCoachView (authenticated)
// ---------------------------------------------------------------------------

/** Minimal CoachDashboardData carrying only what buildLiveCoachView reads. */
function dashboard(over: {
  ratio: number | null;
  workout?: Partial<CoachDashboardData["workout"]>;
}): CoachDashboardData {
  const workout = {
    type: "tempo",
    distanceKm: 10,
    paceRange: { min: "4:25", max: "5:20" },
    heartRateCap: 165,
    shoe: "vomero",
    reason: ["Tempo bygger tærskel."],
    ...over.workout,
    // biome-ignore lint/suspicious/noExplicitAny: partial view-model fixture
  } as any;
  return {
    workout,
    weekStrip: [],
    paceSeries: [],
    zoneSeries: [],
    volumeSeries: [],
    loadGauge: { ratio: over.ratio, fraction: 0.5, risk: null, label: "" },
    // biome-ignore lint/suspicious/noExplicitAny: partial view-model fixture
  } as any;
}

const liveActivities: CoachLoadActivityLike[] = [
  { startDate: new Date(2026, 6, 14), distance: 10_000 },
  { startDate: new Date(2026, 6, 12), distance: 8_000 },
];

describe("buildLiveCoachView", () => {
  it("counts the passed-in activities, not the demo fixtures", () => {
    const view = buildLiveCoachView(dashboard({ ratio: 1.0 }), liveActivities, NOW);
    expect(view.activityCount).toBe(2);
  });

  it("builds the focus quote from a training workout", () => {
    const view = buildLiveCoachView(dashboard({ ratio: 1.0 }), liveActivities, NOW);
    expect(view.focusQuote).toContain("Tempotur");
    expect(view.focusQuote).toContain("10 km");
    expect(view.focusQuote).toContain("165");
  });

  it("uses the rest-day reason as the focus quote on a rest recommendation", () => {
    const view = buildLiveCoachView(
      dashboard({ ratio: 1.0, workout: { type: "rest", reason: ["Hviledag i dag."] } }),
      liveActivities,
      NOW
    );
    expect(view.focusQuote).toBe("Hviledag i dag.");
  });

  it("peaks readiness when the ratio sits on the chronic base (≈1)", () => {
    const balanced = buildLiveCoachView(dashboard({ ratio: 1.0 }), liveActivities, NOW);
    const spiking = buildLiveCoachView(dashboard({ ratio: 1.8 }), liveActivities, NOW);
    expect(balanced.form.pct).toBeGreaterThan(spiking.form.pct);
    expect(balanced.form.pct).toBeLessThanOrEqual(95);
  });

  it("falls back to a fixed readiness when there is no ratio yet", () => {
    const view = buildLiveCoachView(dashboard({ ratio: null }), liveActivities, NOW);
    expect(view.form.pct).toBe(72);
    expect(view.load.status).toBe("OPTIMAL");
    expect(view.initialMessages[2].text).toContain("foreløbigt");
  });

  it("marks a rising load as STIGENDE/cobalt and a falling one as FALDENDE/red", () => {
    const rising = buildLiveCoachView(dashboard({ ratio: 1.2 }), liveActivities, NOW);
    expect(rising.form.trend).toBe("STIGENDE");
    expect(rising.form.trendTone).toBe("cobalt");

    const falling = buildLiveCoachView(dashboard({ ratio: 0.7 }), liveActivities, NOW);
    expect(falling.form.trend).toBe("FALDENDE");
    expect(falling.form.trendTone).toBe("red");
  });

  it("surfaces the acute:chronic ratio in the load answer message", () => {
    const view = buildLiveCoachView(dashboard({ ratio: 1.25 }), liveActivities, NOW);
    expect(view.initialMessages[2].text).toContain("1.25");
    expect(view.load.status).toBe("OPTIMAL");
  });
});
