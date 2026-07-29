import { describe, expect, it } from "vitest";
import type { CoachDashboardData } from "@/lib/coach/dashboard";
import {
  buildCoachView,
  buildLiveCoachView,
  type CoachLoadActivityLike,
  loadStatusFromRatio,
} from "@/lib/cobalt/coach";
import { demoActivities } from "@/lib/demo/data";

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

  it("opens with a single synthetic coach bubble — no fabricated user turn (issue #201)", () => {
    expect(view.initialMessages).toHaveLength(1);
    expect(view.initialMessages[0].role).toBe("coach");
    expect(view.initialMessages.every((m) => m.synthetic === true)).toBe(true);
    expect(view.initialMessages.some((m) => m.role === "user")).toBe(false);
  });

  it("folds the long-run summary and recommendation into the opening bubble", () => {
    const opener = view.initialMessages[0].text;
    expect(opener).toMatch(/km i snit/);
    expect(opener).toContain("progressiv");
  });

  it("exposes the three quick-prompt chips", () => {
    expect(view.prompts).toHaveLength(3);
    expect(view.prompts).toContain("Analysér min uge");
  });

  it("scripts a demo answer for every chip so visitors never hit the 401 chat (issue #203)", () => {
    expect(view.demoReplies).toBeDefined();
    for (const prompt of view.prompts) {
      const reply = view.demoReplies?.[prompt];
      expect(typeof reply?.text).toBe("string");
      expect((reply?.text ?? "").length).toBeGreaterThan(0);
    }
  });

  it("attaches the actual long run as a clickable ActivityCard block, matching the fixture (issue #235)", () => {
    const from = NOW.getTime() - 7 * 86_400_000;
    // The same fixture buildCoachView's longest-in-window read selects.
    const longest = demoActivities
      .filter((a) => a.startDate.getTime() >= from)
      .reduce((best, a) => (a.distance > best.distance ? a : best));

    const block = view.demoReplies?.["Analysér min uge"]?.blocks?.find(
      (b) => b.kind === "activity"
    );
    expect(block).toBeDefined();
    if (block?.kind === "activity") {
      expect(block.activity.id).toBe(longest.id);
      expect(block.activity.distance).toBe(longest.distance);
      expect(block.activity.movingTime).toBe(longest.movingTime);
      expect(block.activity.averageHeartrate).toBe(longest.averageHeartrate);
      expect(block.activity.startDate).toBe(longest.startDate.toISOString());
    }
  });

  it("attaches a 10 km tempo WorkoutCard block to the next-session reply (issue #235)", () => {
    const block = view.demoReplies?.["Foreslå næste pas"]?.blocks?.find(
      (b) => b.kind === "workout"
    );
    expect(block).toBeDefined();
    if (block?.kind === "workout") {
      expect(block.workout.type).toBe("tempo");
      expect(block.workout.distanceKm).toBe(10);
      expect(block.workout.paceRange).toEqual({ min: "4:25", max: "5:20" });
      expect(block.workout.reason.length).toBeGreaterThan(0);
    }
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

  it("leaves demoReplies undefined — a signed-in user gets the live chat, not scripts (issue #203)", () => {
    const view = buildLiveCoachView(dashboard({ ratio: 1.0 }), liveActivities, NOW);
    expect(view.demoReplies).toBeUndefined();
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
    expect(view.initialMessages[0].text).toContain("foreløbigt");
  });

  it("marks a rising load as STIGENDE/cobalt and a falling one as FALDENDE/red", () => {
    const rising = buildLiveCoachView(dashboard({ ratio: 1.2 }), liveActivities, NOW);
    expect(rising.form.trend).toBe("STIGENDE");
    expect(rising.form.trendTone).toBe("cobalt");

    const falling = buildLiveCoachView(dashboard({ ratio: 0.7 }), liveActivities, NOW);
    expect(falling.form.trend).toBe("FALDENDE");
    expect(falling.form.trendTone).toBe("red");
  });

  it("surfaces the acute:chronic ratio in the opening bubble", () => {
    const view = buildLiveCoachView(dashboard({ ratio: 1.25 }), liveActivities, NOW);
    expect(view.initialMessages[0].text).toContain("1.25");
    expect(view.load.status).toBe("OPTIMAL");
  });

  it("opens with a single synthetic coach bubble — no fabricated user turn (issue #201)", () => {
    const view = buildLiveCoachView(dashboard({ ratio: 1.0 }), liveActivities, NOW);
    expect(view.initialMessages).toHaveLength(1);
    expect(view.initialMessages[0].role).toBe("coach");
    expect(view.initialMessages[0].synthetic).toBe(true);
    expect(view.initialMessages.some((m) => m.role === "user")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildLiveCoachView — persisted chat history (issue #202)
// ---------------------------------------------------------------------------

// The signed-in user's stored conversation (getChatHistory shape) must be shown
// in the panel: prepended to the transcript, before the synthetic opener, as
// real (non-synthetic) turns so it also serves as the route's fallback context.
describe("buildLiveCoachView with persisted chat history (issue #202 + #205)", () => {
  const history = [
    { id: "h-user-1", role: "user" as const, content: "Hvad skal jeg løbe i dag?" },
    { id: "h-assistant-1", role: "assistant" as const, content: "En rolig tur på 6 km." },
  ];

  it("shows the persisted history and skips the synthetic opener (issue #205)", () => {
    const view = buildLiveCoachView(
      dashboard({ ratio: 1.0 }),
      liveActivities,
      NOW,
      undefined,
      history
    );
    expect(view.initialMessages).toHaveLength(2);
    expect(view.initialMessages[0]).toMatchObject({
      role: "user",
      text: "Hvad skal jeg løbe i dag?",
      clientId: "h-user-1",
    });
    expect(view.initialMessages[1]).toMatchObject({
      role: "coach",
      text: "En rolig tur på 6 km.",
      clientId: "h-assistant-1",
    });
    expect(view.initialMessages.some((m) => m.synthetic)).toBe(false);
  });

  it("marks history turns as real (non-synthetic) so they persist as fallback context", () => {
    const view = buildLiveCoachView(
      dashboard({ ratio: 1.0 }),
      liveActivities,
      NOW,
      undefined,
      history
    );
    expect(view.initialMessages[0].synthetic).toBeUndefined();
    expect(view.initialMessages[1].synthetic).toBeUndefined();
  });

  it("gives every message a unique id", () => {
    const view = buildLiveCoachView(
      dashboard({ ratio: 1.0 }),
      liveActivities,
      NOW,
      undefined,
      history
    );
    const ids = view.initialMessages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows only the synthetic opener when there is no history", () => {
    const view = buildLiveCoachView(dashboard({ ratio: 1.0 }), liveActivities, NOW, undefined, []);
    expect(view.initialMessages).toHaveLength(1);
    expect(view.initialMessages[0].synthetic).toBe(true);
  });

  it("replays rehydrated activity blocks on persisted assistant turns (issue #228)", () => {
    const history = [
      { id: "h-user-1", role: "user" as const, content: "Hvad var mit seneste løb?" },
      {
        id: "h-assistant-1",
        role: "assistant" as const,
        content: "Her er turen.",
        blocks: [
          {
            kind: "activity" as const,
            activity: {
              id: "act-42",
              type: "Run",
              startDate: "2026-07-25T06:00:00.000Z",
              distance: 8000,
              movingTime: 2400,
              averageHeartrate: 148,
            },
          },
        ],
      },
    ];

    const view = buildLiveCoachView(
      dashboard({ ratio: 1.0 }),
      liveActivities,
      NOW,
      undefined,
      history
    );

    expect(view.initialMessages).toHaveLength(2);
    expect(view.initialMessages[1]).toMatchObject({
      role: "coach",
      text: "Her er turen.",
      clientId: "h-assistant-1",
    });
    expect(view.initialMessages[1].blocks).toHaveLength(1);
    expect(view.initialMessages[1].blocks?.[0].kind).toBe("activity");
  });
});

// Production regression (issue #194): live activities come from Neon with
// `startDate` as an ISO string, and buildLiveCoachView's daily-load math routes
// them through startOfDay(...).getDate(). Without ensureDate that throws
// "getDate is not a function"; demo fixtures (Date objects) never hit it.
describe("buildLiveCoachView with ISO-string startDate (issue #194)", () => {
  // The DB row types startDate as Date but the driver returns a string.
  const asString = (iso: string) => iso as unknown as Date;
  const stringActivities: CoachLoadActivityLike[] = [
    { startDate: asString("2026-07-14T07:30:00Z"), distance: 10_000 },
    { startDate: asString("2026-07-12T07:30:00Z"), distance: 8_000 },
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
        { startDate: new Date("2026-07-14T07:30:00Z"), distance: 10_000 },
        { startDate: new Date("2026-07-12T07:30:00Z"), distance: 8_000 },
      ],
      NOW
    );

    expect(fromString.activityCount).toBe(2);
    expect(fromString.load.bars).toEqual(fromDate.load.bars);
  });
});
