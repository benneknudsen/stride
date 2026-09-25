import { describe, expect, it } from "vitest";
import type { CoachDashboardData } from "@/lib/coach/dashboard";
import {
  buildCoachView,
  buildLiveCoachView,
  type CoachLoadActivityLike,
  loadStatusFromRatio,
} from "@/lib/cobalt/coach";
import { SAME_DAY_RUN_NOTE } from "@/lib/cobalt/readiness";
import { demoActivities } from "@/lib/demo/data";

/**
 * Unit tests for the Coach view-model (lib/cobalt/coach.ts).
 *
 * loadStatusFromRatio is pure. buildCoachView reads the demo fixtures and is
 * deterministic given a fixed `now`. buildLiveCoachView is driven by a minimal
 * hand-built CoachDashboardData so the derivations (form %, trend, focus quote,
 * load status, same-day override) can be asserted without the full dashboard
 * pipeline.
 */

// The demo fixtures anchor their dates to "today" (startOfToday()); derive
// the view-model's `now` from the newest fixture so the load window and the
// activity window always overlap — the test stays deterministic because the
// value is computed once at module load (issue #263).
const NOW = new Date(demoActivities[0].startDate);
const DAY_MS = 86_400_000;

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
  hoursSinceHardEffort?: number | null;
  hoursSinceLastRun?: number | null;
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
    paceSeries: [],
    zoneSeries: [],
    volumeSeries: [],
    loadGauge: { ratio: over.ratio, fraction: 0.5, risk: null, label: "" },
    hoursSinceHardEffort: over.hoursSinceHardEffort ?? null,
    hoursSinceLastRun: over.hoursSinceLastRun ?? null,
    // biome-ignore lint/suspicious/noExplicitAny: partial view-model fixture
  } as any;
}

// Derived from NOW so the load window (NOW−13d … NOW) actually contains them,
// regardless of when the suite runs (issue #263).
const liveActivities: CoachLoadActivityLike[] = [
  { startDate: new Date(NOW.getTime() - 1 * DAY_MS), distance: 10_000 },
  { startDate: new Date(NOW.getTime() - 3 * DAY_MS), distance: 8_000 },
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
  });

  it("marks a rising load as STIGENDE/cobalt and a falling one as FALDENDE/red", () => {
    const rising = buildLiveCoachView(dashboard({ ratio: 1.2 }), liveActivities, NOW);
    expect(rising.form.trend).toBe("STIGENDE");
    expect(rising.form.trendTone).toBe("cobalt");

    const falling = buildLiveCoachView(dashboard({ ratio: 0.7 }), liveActivities, NOW);
    expect(falling.form.trend).toBe("FALDENDE");
    expect(falling.form.trendTone).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// buildLiveCoachView — same-day run in the form card (issue #273)
// ---------------------------------------------------------------------------

// A rolig Zone 1–2 tur never trips the #259 hard-effort cap, so the load read
// alone still says "Klar til hårdt pas" hours after the runner was out — while
// the recommender already calls today a hviledag. When the newest run sits
// inside the 24 h recovery window the form card must name the run instead — the
// same story the Hjem hero tells.
describe("buildLiveCoachView — same-day run in the form card (issue #273)", () => {
  it("replaces the ready-band claim with the same-day line when the newest run is inside 24 h", () => {
    const view = buildLiveCoachView(
      dashboard({ ratio: 1.0, hoursSinceLastRun: 4 }),
      liveActivities,
      NOW
    );
    expect(view.form.sameDayNote).toBe(SAME_DAY_RUN_NOTE);
  });

  it("leaves the readiness number and band note untouched — the cap is the only override", () => {
    const withRun = buildLiveCoachView(
      dashboard({ ratio: 1.0, hoursSinceLastRun: 4 }),
      liveActivities,
      NOW
    );
    const withoutRun = buildLiveCoachView(
      dashboard({ ratio: 1.0, hoursSinceLastRun: 30 }),
      liveActivities,
      NOW
    );
    expect(withRun.form.pct).toBe(withoutRun.form.pct);
    expect(withRun.form.note).toBe(withoutRun.form.note);
    expect(withRun.form.note).toBe("Klar til hårdt pas");
  });

  it("keeps the ready band once the newest run is past the 24 h window", () => {
    const view = buildLiveCoachView(
      dashboard({ ratio: 1.0, hoursSinceLastRun: 30 }),
      liveActivities,
      NOW
    );
    expect(view.form.sameDayNote).toBeUndefined();
  });

  it("sets no override when there is no run at all (null)", () => {
    const view = buildLiveCoachView(
      dashboard({ ratio: 1.0, hoursSinceLastRun: null }),
      liveActivities,
      NOW
    );
    expect(view.form.sameDayNote).toBeUndefined();
  });

  it("leaves the easy band alone — only the ready claim is replaced", () => {
    // Ratio 1.5 → readinessFromRatio lands in the easy band, whose note never
    // promised a hard pas — the same-day line has nothing to override there.
    const view = buildLiveCoachView(
      dashboard({ ratio: 1.5, hoursSinceLastRun: 4 }),
      liveActivities,
      NOW
    );
    expect(view.form.note).toBe("Let træning anbefalet");
    expect(view.form.sameDayNote).toBeUndefined();
  });
});

// Production regression (issue #194): live activities come from Neon with
// `startDate` as an ISO string, and buildLiveCoachView's daily-load math routes
// them through startOfDay(...).getDate(). Without ensureDate that throws
// "getDate is not a function"; demo fixtures (Date objects) never hit it.
describe("buildLiveCoachView with ISO-string startDate (issue #194)", () => {
  // The DB row types startDate as Date but the driver returns a string. The
  // instants are derived from NOW so the load bars are non-trivially populated
  // whenever the suite runs (issue #263).
  const asString = (iso: string) => iso as unknown as Date;
  const recent = new Date(NOW.getTime() - 1 * DAY_MS).toISOString();
  const older = new Date(NOW.getTime() - 3 * DAY_MS).toISOString();
  const stringActivities: CoachLoadActivityLike[] = [
    { startDate: asString(recent), distance: 10_000 },
    { startDate: asString(older), distance: 8_000 },
  ];

  it("does not throw when startDate is an ISO string from the DB", () => {
    expect(() =>
      buildLiveCoachView(dashboard({ ratio: 1.0 }), stringActivities, NOW)
    ).not.toThrow();
  });

  it("builds the same load bars as the equivalent Date-typed activities", () => {
    const fromString = buildLiveCoachView(dashboard({ ratio: 1.0 }), stringActivities, NOW);
    const fromDate = buildLiveCoachView(
      dashboard({ ratio: 1.0 }),
      [
        { startDate: new Date(recent), distance: 10_000 },
        { startDate: new Date(older), distance: 8_000 },
      ],
      NOW
    );

    expect(fromString.activityCount).toBe(2);
    expect(fromString.load.bars).toEqual(fromDate.load.bars);
  });
});
