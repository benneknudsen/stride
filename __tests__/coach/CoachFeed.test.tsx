/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { CoachFeed } from "@/components/cobalt/coach-dashboard/CoachFeed";

// Issue #265: CoachFeed streams /api/ai/analyze without an AbortController and
// its mount effect has no cleanup, so a navigation away mid-stream kept the
// reader loop downloading and calling setBlocks/setStatus on an unmounted
// component. These tests pin the abort-based lifecycle: the mount effect
// aborts on cleanup, aborted runs fail silently (no error state), the happy
// path is unchanged, and the error copy for 401/429/network stays as it was.

const activities = [
  {
    startDate: new Date("2026-07-06"),
    distance: 8.2,
    movingTime: 2700,
    averageSpeed: 3.04,
    averageHeartrate: 142,
    totalElevationGain: 45,
  },
];

const INSIGHT_CARD_LINE = JSON.stringify({
  tool: "insightCard",
  title: "Formen er stabil",
  body: "Du har holdt et jævnt niveau i 4 uger.",
  metric: "Status",
  sentiment: "positive",
});

const TREND_CALLOUT_LINE = JSON.stringify({
  tool: "trendCallout",
  title: "Ugevolumen stiger",
  body: "Dine ugentlige kilometer går den rigtige vej.",
  metric: "Ugevolumen",
  changeLabel: "+18%",
  direction: "up",
});

/** A NDJSON body delivered in one chunk, then closed. */
function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

/**
 * A stream that stays open until the fetch signal aborts — mirroring real
 * fetch semantics: once aborted, pending and future reads reject, which is
 * what surfaces an AbortError in runFeed's catch.
 */
function holdOpenStream(signal: AbortSignal | null | undefined): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => {
        controller.error(new DOMException("The operation was aborted.", "AbortError"));
      });
    },
  });
}

/** One macrotask turn — enough for the abort rejection to reach the catch. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("CoachFeed — abort-based stream lifecycle (issue #265)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("unmount mid-stream aborts the fetch signal and leaves no unhandled rejection", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      signals.push(signal);
      return new Response(holdOpenStream(signal), { status: 200 });
    });

    const { unmount } = render(<CoachFeed activities={activities} />);
    await waitFor(() => expect(signals.length).toBe(1));
    expect(signals[0]).toBeDefined();
    expect(screen.getByText("Læser din træning…")).toBeDefined();

    unmount();

    // The cleanup must have aborted the in-flight stream's signal.
    expect(signals[0]?.aborted).toBe(true);

    // Let the aborted reader rejection land in runFeed's catch: it must be
    // handled there (vitest fails the whole run on unhandled rejections) and,
    // with the component gone, must never reach a setState.
    await flush();
    await flush();
  });

  test("aborted run fails silently — no error state, exactly one surviving stream", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      signals.push(signal);
      // Run 1 holds open until aborted; run 2 delivers and closes.
      if (signals.length === 1) return new Response(holdOpenStream(signal), { status: 200 });
      return new Response(streamOf(`${INSIGHT_CARD_LINE}\n`), { status: 200 });
    });

    const { rerender } = render(<CoachFeed activities={activities} />);
    await waitFor(() => expect(signals.length).toBe(1));

    // A changed activities prop re-runs the mount effect — cleanup aborts
    // run 1 (the StrictMode remount path) and run 2 starts fresh.
    rerender(<CoachFeed activities={[...activities]} />);
    await waitFor(() => expect(signals.length).toBe(2));
    expect(signals[0]?.aborted).toBe(true);

    // Run 1's abort rejection must never surface as an error state.
    expect(screen.queryByText("Kunne ikke hente coach-feedet lige nu. Prøv igen.")).toBeNull();
    expect(screen.queryByText("Log ind for at se coach-indsigter.")).toBeNull();

    // Run 2 is the one surviving stream: it renders and completes to done.
    await waitFor(() => expect(screen.getByText("Formen er stabil")).toBeDefined());
    await waitFor(() => expect(screen.getByText("Genanalyser")).toBeDefined());

    await flush();
  });

  test("happy path regression: streamed blocks render and status ends on done", async () => {
    const ndjson = [INSIGHT_CARD_LINE, TREND_CALLOUT_LINE, ""].join("\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(streamOf(ndjson), { status: 200 })
    );

    render(<CoachFeed activities={activities} />);

    await waitFor(() => {
      expect(screen.getByText("Formen er stabil")).toBeDefined();
      expect(screen.getByText("Ugevolumen stiger")).toBeDefined();
    });
    await waitFor(() => expect(screen.getByText("Genanalyser")).toBeDefined());
    expect(screen.queryByText("Læser din træning…")).toBeNull();
    expect(screen.queryByText("Kunne ikke hente coach-feedet lige nu. Prøv igen.")).toBeNull();
  });
});

describe("CoachFeed — error paths unchanged", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("401 shows the login message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));

    render(<CoachFeed activities={activities} />);

    await waitFor(() => {
      expect(screen.getByText("Log ind for at se coach-indsigter.")).toBeDefined();
    });
  });

  test("429 shows the rate-limit message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 429 }));

    render(<CoachFeed activities={activities} />);

    await waitFor(() => {
      expect(screen.getByText("Du har nået grænsen. Prøv igen om et øjeblik.")).toBeDefined();
    });
  });

  test("500 shows the default network message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<CoachFeed activities={activities} />);

    await waitFor(() => {
      expect(screen.getByText("Kunne ikke hente coach-feedet lige nu. Prøv igen.")).toBeDefined();
    });
  });
});
