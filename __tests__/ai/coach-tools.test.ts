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

// biome-ignore lint/suspicious/noExplicitAny: workaround for AI SDK's FlexibleSchema type not exposing safeParse
function parse(t: { inputSchema: any }, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: see above
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

/**
 * The Neon driver hands `timestamp` columns back as ISO strings, so a live row's
 * `startDate` is a string while every demo fixture is a real `Date`. The
 * last-run reduce parked the raw value in a `Date`-typed accumulator, so from
 * the *second* run onwards the next iteration called `.getTime()` on a string:
 * `TypeError: e.getTime is not a function`, thrown synchronously in
 * `buildCoachTools` — outside the route's stream and outside any try/catch, so
 * POST /api/ai/chat answered 500 and no provider was ever called.
 *
 * Two runs minimum: with one, the accumulator is only ever written, never read.
 */
describe("coach tools — string dates from the Neon driver (#190/#194/#195)", () => {
  const AS_DATES: CoachChatActivity[] = [
    {
      type: "Run",
      startDate: new Date("2026-07-21T06:00:00.000Z"),
      distance: 10000,
      movingTime: 3000,
      averageHeartrate: 152,
      hrZones: null,
    },
    {
      type: "Run",
      startDate: new Date("2026-07-25T06:00:00.000Z"),
      distance: 8000,
      movingTime: 2400,
      averageHeartrate: 148,
      hrZones: null,
    },
  ];

  const AS_STRINGS: CoachChatActivity[] = AS_DATES.map((a) => ({
    ...a,
    startDate: (a.startDate as Date).toISOString(),
  }));

  it("builds the tools without throwing when every startDate is a string", () => {
    expect(() =>
      buildCoachTools("user-1", NOW, { raceDate: null, raceName: null }, AS_STRINGS)
    ).not.toThrow();
  });

  it("produces the same recommendation from string dates as from Date objects", async () => {
    const fromDates = await buildCoachTools(
      "user-1",
      NOW,
      { raceDate: null, raceName: null },
      AS_DATES
    ).recommendWorkout.execute?.({} as never, {} as never);
    const fromStrings = await buildCoachTools(
      "user-1",
      NOW,
      { raceDate: null, raceName: null },
      AS_STRINGS
    ).recommendWorkout.execute?.({} as never, {} as never);

    expect(fromStrings).toBeTruthy();
    // Identical output is the real assertion: the last-run date drives the
    // recommender's recovery math, so a mishandled string would diverge here
    // even if it stopped throwing.
    expect(JSON.stringify(fromStrings)).toBe(JSON.stringify(fromDates));
  });

  it("ignores runs dated in the future when resolving the last run", async () => {
    const withFuture: CoachChatActivity[] = [
      ...AS_STRINGS,
      { ...AS_DATES[1], startDate: new Date("2026-08-10T06:00:00.000Z").toISOString() },
    ];
    const result = await buildCoachTools(
      "user-1",
      NOW,
      { raceDate: null, raceName: null },
      withFuture
    ).recommendWorkout.execute?.({} as never, {} as never);
    const baseline = await buildCoachTools(
      "user-1",
      NOW,
      { raceDate: null, raceName: null },
      AS_STRINGS
    ).recommendWorkout.execute?.({} as never, {} as never);

    expect(JSON.stringify(result)).toBe(JSON.stringify(baseline));
  });
});
