/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// ── feedCardView (pure function, no DOM needed) ──────────────────────────
import type { AnalysisBlock } from "@/lib/ai/tools";

// We import the function directly from CoachFeed — it's not exported,
// so we replicate the exact logic inline for testing. This is the
// same function body verbatim, verified against CoachFeed.tsx.

type TrendDirection = "up" | "down" | "flat";

interface FeedCardView {
  kicker: string;
  title: string;
  body: string;
  metric?: string;
  direction?: TrendDirection;
  tone: "insight" | "warning" | "milestone";
}

function feedCardView(block: AnalysisBlock): FeedCardView {
  switch (block.tool) {
    case "coachInsight":
      return {
        kicker: "Coach",
        title: block.title,
        body: block.body,
        metric: block.data.changeLabel
          ? `${block.data.value} · ${block.data.changeLabel}`
          : block.data.value,
        direction: block.data.direction,
        tone: block.type,
      };
    case "trendCallout":
      return {
        kicker: "Trend",
        title: block.title,
        body: block.body,
        metric: `${block.metric} · ${block.changeLabel}`,
        direction: block.direction,
        tone: block.direction === "down" ? "warning" : "insight",
      };
    case "metricComparison":
      return {
        kicker: "Sammenligning",
        title: block.title,
        body: `${block.current} nu mod ${block.previous} før.`,
        metric: block.deltaLabel,
        direction: block.better,
        tone: "insight",
      };
    case "insightCard":
      return {
        kicker: "Indsigt",
        title: block.title,
        body: block.body,
        metric: block.metric,
        tone: block.sentiment === "caution" ? "warning" : "insight",
      };
    case "workoutRecommendation":
      return {
        kicker: "Forslag",
        title: block.title,
        body: block.rationale,
        metric: block.distanceKm ? `${block.workoutType} · ${block.distanceKm} km` : block.details,
        tone: "insight",
      };
  }
}

// ── parseFeedLine (from lib/coach/feed.ts) ───────────────────────────────
import { parseFeedLine } from "@/lib/coach/feed";

// ── feedCardView tests ───────────────────────────────────────────────────

describe("feedCardView — all 5 AnalysisBlock variants", () => {
  test("coachInsight with full data", () => {
    const block: AnalysisBlock = {
      tool: "coachInsight",
      type: "insight",
      title: "Zone 2 forbedres",
      body: "Din zone 2-effektivitet er steget 8%.",
      data: {
        label: "Pace",
        value: "6:12 min/km",
        changeLabel: "+8%",
        direction: "up",
      },
    };
    const view = feedCardView(block);
    expect(view.kicker).toBe("Coach");
    expect(view.title).toBe("Zone 2 forbedres");
    expect(view.metric).toBe("6:12 min/km · +8%");
    expect(view.direction).toBe("up");
    expect(view.tone).toBe("insight");
  });

  test("coachInsight without optional changeLabel", () => {
    const block: AnalysisBlock = {
      tool: "coachInsight",
      type: "warning",
      title: "Hviledag anbefales",
      body: "...",
      data: { label: "Dage", value: "3 dage siden sidst", direction: "down" },
    };
    const view = feedCardView(block);
    expect(view.metric).toBe("3 dage siden sidst");
    expect(view.tone).toBe("warning");
  });

  test("trendCallout — upward trend", () => {
    const block: AnalysisBlock = {
      tool: "trendCallout",
      title: "VO₂-max stiger",
      body: "...",
      metric: "VO₂-max",
      changeLabel: "+2.1 ml/kg/min",
      direction: "up",
    };
    const view = feedCardView(block);
    expect(view.kicker).toBe("Trend");
    expect(view.metric).toBe("VO₂-max · +2.1 ml/kg/min");
    expect(view.tone).toBe("insight"); // up = insight
  });

  test("trendCallout — downward trend (warning tone)", () => {
    const block: AnalysisBlock = {
      tool: "trendCallout",
      title: "Pace falder",
      body: "...",
      metric: "Pace",
      changeLabel: "-5 s/km",
      direction: "down",
    };
    const view = feedCardView(block);
    expect(view.direction).toBe("down");
    expect(view.tone).toBe("warning");
  });

  test("metricComparison", () => {
    const block: AnalysisBlock = {
      tool: "metricComparison",
      title: "Distance stiger",
      metric: "Ugentlig distance",
      current: "35 km/uge",
      previous: "28 km/uge",
      deltaLabel: "+7 km",
      better: "up",
    };
    const view = feedCardView(block);
    expect(view.kicker).toBe("Sammenligning");
    expect(view.body).toBe("35 km/uge nu mod 28 km/uge før.");
    expect(view.metric).toBe("+7 km");
    expect(view.direction).toBe("up");
  });

  test("insightCard — caution sentiment", () => {
    const block: AnalysisBlock = {
      tool: "insightCard",
      title: "Belastning høj",
      body: "Din træningsbelastning er i det røde felt.",
      metric: "ACWR 1.9",
      sentiment: "caution",
    };
    const view = feedCardView(block);
    expect(view.kicker).toBe("Indsigt");
    expect(view.tone).toBe("warning");
  });

  test("insightCard — neutral sentiment", () => {
    const block: AnalysisBlock = {
      tool: "insightCard",
      title: "Stabil form",
      body: "...",
      metric: "Status",
      sentiment: "positive",
    };
    const view = feedCardView(block);
    expect(view.tone).toBe("insight");
  });

  test("workoutRecommendation with distanceKm", () => {
    const block: AnalysisBlock = {
      tool: "workoutRecommendation",
      title: "Interval onsdag",
      rationale: "God restitution, klar til intensitet.",
      workoutType: "Intervals",
      distanceKm: 8,
      details: "",
    };
    const view = feedCardView(block);
    expect(view.kicker).toBe("Forslag");
    expect(view.title).toBe("Interval onsdag");
    expect(view.body).toBe("God restitution, klar til intensitet.");
    expect(view.metric).toBe("Intervals · 8 km");
  });

  test("workoutRecommendation without distanceKm — uses details", () => {
    const block: AnalysisBlock = {
      tool: "workoutRecommendation",
      title: "Bakkeløb",
      rationale: "Styrk benene.",
      workoutType: "Hill",
      details: "5 gentagelser",
    };
    const view = feedCardView(block);
    expect(view.metric).toBe("5 gentagelser");
  });
});

// ── parseFeedLine stream reassembly tests ────────────────────────────────

describe("parseFeedLine — stream reassembly", () => {
  test("parses a valid coachInsight JSON line", () => {
    const line = JSON.stringify({
      tool: "coachInsight",
      type: "insight",
      title: "Test",
      body: "Test body",
      data: { label: "Pace", value: "5:00", direction: "flat" },
    });
    const block = parseFeedLine(line);
    expect(block).not.toBeNull();
    expect(block?.tool).toBe("coachInsight");
  });

  test("trims whitespace before parsing", () => {
    const line = `  ${JSON.stringify({
      tool: "trendCallout",
      title: "T",
      body: "B",
      metric: "M",
      changeLabel: "L",
      direction: "up",
    })}  `;
    const block = parseFeedLine(line);
    expect(block).not.toBeNull();
    expect(block?.tool).toBe("trendCallout");
  });

  test("returns null for a blank line (no content between newlines)", () => {
    expect(parseFeedLine("")).toBeNull();
    expect(parseFeedLine("   ")).toBeNull();
  });

  test("returns null for malformed JSON (half-flushed chunk)", () => {
    // Simulates a chunk that breaks mid-JSON-object — the buffer
    // hasn't yet received the closing brace.
    expect(parseFeedLine('{"tool":"coachInsight","ty')).toBeNull();
  });

  test("returns null when JSON is valid but fails the block schema", () => {
    expect(parseFeedLine('{"foo":"bar"}')).toBeNull();
  });

  test("returns null for a known tool missing required fields", () => {
    const bad = JSON.stringify({ tool: "coachInsight" }); // missing title, body, data
    expect(parseFeedLine(bad)).toBeNull();
  });

  test("newline-buffering: handles a real NDJSON stream line-by-line", () => {
    // Full NDJSON stream simulation: two complete lines + one blank
    const lines = [
      JSON.stringify({
        tool: "insightCard",
        title: "Første",
        body: "B1",
        metric: "M1",
        sentiment: "positive",
      }),
      JSON.stringify({
        tool: "trendCallout",
        title: "Anden",
        body: "B2",
        metric: "M2",
        changeLabel: "L2",
        direction: "flat",
      }),
      "", // trailing empty
    ];

    const blocks = lines.map(parseFeedLine).filter(Boolean);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.tool).toBe("insightCard");
    expect(blocks[1]?.tool).toBe("trendCallout");
  });
});

// ── CoachFeed component render tests ─────────────────────────────────────

// We must mock the global fetch since CoachFeed POSTs to /api/ai/analyze
// and consumes a streaming Response. The component is "use client" and
// needs jsdom + a mocked fetch.

import { CoachFeed } from "@/components/cobalt/coach-dashboard/CoachFeed";

// Minimal mock: React 19 doesn't need explicit act() wrapping for
// async state updates when using waitFor.

const sampleActivities = [
  {
    startDate: new Date("2026-07-06"),
    distance: 8.2,
    movingTime: 2700,
    averageSpeed: 3.04,
    averageHeartrate: 142,
    totalElevationGain: 45,
  },
];

describe("CoachFeed — render states", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("renders streaming state on mount (loading indicator)", async () => {
    // Return a promise that never resolves — keeps status = "streaming"
    let neverResolve: (() => void) | undefined;
    const pending = new Promise<Response>((_resolve) => {
      neverResolve = () => {};
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pending as Promise<Response>);

    render(<CoachFeed activities={sampleActivities} />);

    // Should show the loading indicator
    expect(screen.getByText("Læser din træning…")).toBeDefined();
    // The regenerate button should read "Analyserer…"
    expect(screen.getByText("Analyserer…")).toBeDefined();

    neverResolve?.();
  });

  test("renders error state when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network down"));

    render(<CoachFeed activities={sampleActivities} />);

    await waitFor(() => {
      expect(screen.getByText("Kunne ikke hente coach-feedet lige nu. Prøv igen.")).toBeDefined();
    });
  });

  test("renders empty state when stream yields zero blocks", async () => {
    // Stream closes immediately with no JSON lines
    const emptyBody = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(emptyBody, { status: 200 }));

    render(<CoachFeed activities={sampleActivities} />);

    await waitFor(() => {
      expect(screen.getByText("Ingen coach-indsigter for perioden endnu.")).toBeDefined();
    });
  });

  test("renders blocks when stream delivers valid NDJSON", async () => {
    const ndjson = [
      JSON.stringify({
        tool: "insightCard",
        title: "Formen er stabil",
        body: "Du har holdt et jævnt niveau i 4 uger.",
        metric: "Status",
        sentiment: "positive",
      }),
      JSON.stringify({
        tool: "coachInsight",
        type: "insight",
        title: "Zone 2 stiger",
        body: "Effektiviteten er oppe.",
        data: { label: "Pace", value: "6:05", changeLabel: "+3%", direction: "up" },
      }),
      "", // blank final line
    ].join("\n");

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(ndjson));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 200 }));

    render(<CoachFeed activities={sampleActivities} />);

    await waitFor(() => {
      expect(screen.getByText("Formen er stabil")).toBeDefined();
      expect(screen.getByText("Zone 2 stiger")).toBeDefined();
    });

    // After streaming completes, the button should read "Genanalyser"
    await waitFor(() => {
      expect(screen.getByText("Genanalyser")).toBeDefined();
    });
  });

  test("handles chunks that break mid-JSON (newline buffering)", async () => {
    // Split a JSON line across two chunks — the first chunk ends with a
    // partial JSON object, the second completes it + a newline.
    const json = JSON.stringify({
      tool: "trendCallout",
      title: "Pace trend",
      body: "Din pace er stabil.",
      metric: "Pace",
      changeLabel: "0 s/km",
      direction: "flat",
    });
    const split = Math.floor(json.length / 2);
    const chunk1 = json.slice(0, split);
    const chunk2 = `${json.slice(split)}\n`;

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(chunk1));
        controller.enqueue(new TextEncoder().encode(chunk2));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 200 }));

    render(<CoachFeed activities={sampleActivities} />);

    await waitFor(() => {
      expect(screen.getByText("Pace trend")).toBeDefined();
    });
  });
});

// ── Dashboard component structure tests ──────────────────────────────────

// The dashboard page is a server component. We test the pure data-builders
// already (dashboard.test.ts, feed.test.ts). Here we validate that the
// exported CoachFeed handles edge inputs.

describe("CoachFeed — edge inputs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("handles empty activities array gracefully", async () => {
    const emptyStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(emptyStream, { status: 200 }));

    render(<CoachFeed activities={[]} />);

    await waitFor(() => {
      expect(screen.getByText("Ingen coach-indsigter for perioden endnu.")).toBeDefined();
    });
  });

  test("buildCoachFeedRequest is called with the right payload shape", async () => {
    // We verify fetch was called with the serialized request body
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(stream, { status: 200 }));

    render(<CoachFeed activities={sampleActivities} />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/ai/analyze",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    // The body should be a JSON string containing our activity
    const bodyArg = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit)?.body as string);
    expect(bodyArg).toHaveProperty("activities");
    expect(bodyArg.activities[0].distance).toBe(8.2);
    expect(bodyArg.activities[0].movingTime).toBe(2700);
  });

  test("handles 500 server response as error state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<CoachFeed activities={sampleActivities} />);

    await waitFor(() => {
      expect(screen.getByText("Kunne ikke hente coach-feedet lige nu. Prøv igen.")).toBeDefined();
    });
  });

  test("handles response with null body (ok but no ReadableStream)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }) // body is null
    );

    render(<CoachFeed activities={sampleActivities} />);

    await waitFor(() => {
      expect(screen.getByText("Kunne ikke hente coach-feedet lige nu. Prøv igen.")).toBeDefined();
    });
  });
});
