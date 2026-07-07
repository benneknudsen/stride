import { describe, expect, it } from "vitest";
import type { AnalysisBlock } from "@/lib/ai/tools";
import {
  buildCoachFeedRequest,
  COACH_FEED_SCOPE,
  type CoachFeedActivityInput,
  parseFeedLine,
} from "@/lib/coach/feed";

const RUN_DATE = new Date(2026, 6, 15, 8, 0);

function activity(overrides: Partial<CoachFeedActivityInput> = {}): CoachFeedActivityInput {
  return {
    startDate: RUN_DATE,
    distance: 10_000,
    movingTime: 3_000,
    averageSpeed: 3.33,
    averageHeartrate: 145,
    totalElevationGain: 40,
    ...overrides,
  };
}

/** A valid coachInsight NDJSON line, as the analyze endpoint streams it. */
function coachInsightLine(): string {
  const block: AnalysisBlock = {
    tool: "coachInsight",
    type: "insight",
    title: "Room to build",
    body: "Your load sits in the optimal band.",
    data: { label: "Load ratio", value: "1.05", direction: "flat" },
  };
  return JSON.stringify(block);
}

describe("buildCoachFeedRequest", () => {
  it("asks for the progression-aware trend scope", () => {
    const req = buildCoachFeedRequest([activity()]);
    expect(req.scope).toBe(COACH_FEED_SCOPE);
    expect(COACH_FEED_SCOPE).toBe("trend");
  });

  it("serializes Date startDates to ISO strings for the wire", () => {
    const req = buildCoachFeedRequest([activity({ startDate: RUN_DATE })]);
    expect(req.activities[0].startDate).toBe(RUN_DATE.toISOString());
  });

  it("passes an already-string startDate through unchanged", () => {
    const iso = "2026-07-15T06:00:00.000Z";
    const req = buildCoachFeedRequest([activity({ startDate: iso })]);
    expect(req.activities[0].startDate).toBe(iso);
  });

  it("defaults missing optional metrics to null, not undefined", () => {
    const req = buildCoachFeedRequest([
      {
        startDate: RUN_DATE,
        distance: 8_000,
        movingTime: 2_400,
      },
    ]);
    const a = req.activities[0];
    expect(a.averageSpeed).toBeNull();
    expect(a.averageHeartrate).toBeNull();
    expect(a.totalElevationGain).toBeNull();
  });

  it("preserves the activity count and order", () => {
    const req = buildCoachFeedRequest([
      activity({ distance: 5_000 }),
      activity({ distance: 12_000 }),
    ]);
    expect(req.activities).toHaveLength(2);
    expect(req.activities[0].distance).toBe(5_000);
    expect(req.activities[1].distance).toBe(12_000);
  });

  it("produces a JSON-serializable payload", () => {
    const req = buildCoachFeedRequest([activity()]);
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });
});

describe("parseFeedLine", () => {
  it("parses a valid coach-insight block", () => {
    const block = parseFeedLine(coachInsightLine());
    expect(block).not.toBeNull();
    expect(block?.tool).toBe("coachInsight");
  });

  it("trims surrounding whitespace before parsing", () => {
    const block = parseFeedLine(`  ${coachInsightLine()}\n`);
    expect(block?.tool).toBe("coachInsight");
  });

  it("returns null for a blank line", () => {
    expect(parseFeedLine("   ")).toBeNull();
  });

  it("returns null for malformed JSON (a half-flushed chunk)", () => {
    expect(parseFeedLine('{"tool":"coachInsight"')).toBeNull();
  });

  it("returns null when JSON is valid but fails the block schema", () => {
    // Unknown tool → not a member of the discriminated union.
    expect(parseFeedLine('{"tool":"bogus","title":"x"}')).toBeNull();
  });

  it("returns null when a known tool is missing required fields", () => {
    expect(parseFeedLine('{"tool":"coachInsight","title":"x"}')).toBeNull();
  });
});
