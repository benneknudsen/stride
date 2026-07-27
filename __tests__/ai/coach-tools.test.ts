/**
 * Provider-robustness tests for the coach agent tools (issue #200).
 *
 * Models routed through OpenRouter — Google Gemini/Gemma especially — emit an
 * explicit `"field": null` for parameters they choose not to fill. The tool
 * input schemas MUST accept that: with `.optional()`/`.default()` (which reject
 * `null`) the tool call fails validation, the candidate is treated as a dead
 * provider, and the coach chat stops answering. These tests pin the `.nullish()`
 * contract and verify `execute` still produces engine output from null input.
 */

import { describe, expect, it } from "vitest";
import { buildCoachTools, type CoachChatActivity } from "@/lib/ai/coach-tools";

const NOW = new Date("2026-07-27T09:00:00.000Z");

const ACTIVITIES: CoachChatActivity[] = [
  {
    type: "Run",
    startDate: new Date("2026-07-25T06:00:00.000Z"),
    distance: 8000,
    movingTime: 2400,
    averageHeartrate: 148,
    hrZones: null,
  },
];

function tools() {
  return buildCoachTools("user-1", NOW, { raceDate: null, raceName: null }, ACTIVITIES);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse(t: { inputSchema: any }, input: unknown) {
  return (t.inputSchema as any).safeParse(input);
}

describe("coach tools — provider robustness (#200)", () => {
  it("recommendWorkout accepts explicit null for every optional param", async () => {
    const t = tools().recommendWorkout;
    const parsed = parse(t, {
      goal: null,
      footballYesterday: null,
      injuryHistory: null,
      risk: null,
    });
    expect(parsed.success).toBe(true);
    const result = await t.execute?.(parsed.data as never, {} as never);
    expect(result).toBeTruthy();
  });

  it("getProgression declares a parameter (no empty object) and runs with null", async () => {
    const t = tools().getProgression;
    // Empty parameter objects break function-calling on some providers, so the
    // schema must expose at least one property.
    const parsed = parse(t, { reason: null });
    expect(parsed.success).toBe(true);
    const result = await t.execute?.(parsed.data as never, {} as never);
    expect(result).toBeTruthy();
  });

  it("getWeekPlan accepts explicit null for phase and monday", async () => {
    const t = tools().getWeekPlan;
    const parsed = parse(t, { phase: null, monday: null });
    expect(parsed.success).toBe(true);
    const result = await t.execute?.(parsed.data as never, {} as never);
    expect(result).toBeTruthy();
  });

  it("validateWorkout accepts null for every optional param and normalizes it", async () => {
    const t = tools().validateWorkout;
    const parsed = parse(t, {
      plannedDate: "2026-07-28",
      plannedType: null,
      plannedDistanceKm: null,
      plannedZone: null,
      shoeType: null,
      includesStrength: null,
      lastRunDate: null,
      footballYesterday: null,
      phase: null,
      weeklyDistanceKm: null,
      previousWeekDistanceKm: null,
    });
    expect(parsed.success).toBe(true);
    const result = await t.execute?.(parsed.data as never, {} as never);
    expect(result).toBeTruthy();
  });

  it("recommendWorkout still works when the model omits every optional param", async () => {
    const t = tools().recommendWorkout;
    const parsed = parse(t, {});
    expect(parsed.success).toBe(true);
    const result = await t.execute?.(parsed.data as never, {} as never);
    expect(result).toBeTruthy();
  });
});
