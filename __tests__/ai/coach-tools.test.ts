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
import { buildPhases } from "@/lib/coach/engine";

const NOW = new Date("2026-07-27T09:00:00.000Z");

const ACTIVITIES: CoachChatActivity[] = [
  {
    id: "act-1",
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

  it("getRunSuggestions declares a parameter and returns the three suggestions (#244)", async () => {
    const t = tools().getRunSuggestions;
    // Empty parameter objects break function-calling on some providers, so the
    // schema must expose at least one property and tolerate an explicit null.
    const parsed = parse(t, { reason: null });
    expect(parsed.success).toBe(true);
    const result = (await t.execute?.(parsed.data as never, {} as never)) as {
      suggestions: Array<{ type: string; distanceKm: number; paceRange: { min: string } }>;
      phaseLabel: string;
      weekKm: number;
    };
    // The coach reads the three day-agnostic run suggestions and recommends which
    // to do today — so the suggestion data must be present in the tool output.
    expect(result.suggestions.map((s) => s.type)).toEqual(["easy", "tempo", "long"]);
    expect(result.suggestions[0].distanceKm).toBeGreaterThan(0);
    expect(result.suggestions[0].paceRange.min).toMatch(/^\d+:\d{2}$/);
    expect(typeof result.phaseLabel).toBe("string");
    expect(result.weekKm).toBeGreaterThan(0);
  });

  it("getNextActivity declares a parameter (no empty object) and runs with null", async () => {
    const t = tools().getNextActivity;
    // Empty parameter objects break function-calling on some providers, so the
    // schema must expose at least one property.
    const parsed = parse(t, { reason: null });
    expect(parsed.success).toBe(true);
    const result = await t.execute?.(parsed.data as never, {} as never);
    expect(result).toBeTruthy();
  });

  it("getRecentActivities accepts a null limit and returns card-shaped rows (#221)", async () => {
    const t = tools().getRecentActivities;
    const parsed = parse(t, { limit: null });
    expect(parsed.success).toBe(true);
    const result = (await t.execute?.(parsed.data as never, {} as never)) as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({
      id: "act-1",
      type: "Run",
      distance: 8000,
      movingTime: 2400,
      averageHeartrate: 148,
    });
    // The card links to the detail page, so the id must survive, and startDate
    // is serialised to an ISO string for the wire.
    expect(typeof result[0].id).toBe("string");
    expect(result[0].startDate).toBe("2026-07-25T06:00:00.000Z");
  });
});

describe("getRecentActivities — ordering and limit (#221)", () => {
  const MANY: CoachChatActivity[] = Array.from({ length: 7 }, (_, i) => ({
    id: `act-${i}`,
    type: "Run",
    // Oldest first on purpose — the tool must sort newest-first regardless.
    startDate: new Date(2026, 6, 10 + i, 6).toISOString(),
    distance: 8000 + i * 100,
    movingTime: 2400,
    averageHeartrate: 148,
    hrZones: null,
  }));

  function build() {
    return buildCoachTools("user-1", NOW, { raceDate: null, raceName: null }, MANY)
      .getRecentActivities;
  }

  it("returns at most 5 activities, newest first", async () => {
    const result = (await build().execute?.({} as never, {} as never)) as Array<{ id: string }>;
    expect(result).toHaveLength(5);
    // act-6 is the newest (2026-07-16), act-2 the 5th newest (2026-07-12).
    expect(result.map((a) => a.id)).toEqual(["act-6", "act-5", "act-4", "act-3", "act-2"]);
  });

  it("clamps an out-of-range limit into [1, 5]", async () => {
    const one = (await build().execute?.({ limit: 1 } as never, {} as never)) as unknown[];
    expect(one).toHaveLength(1);
    const capped = (await build().execute?.({ limit: 99 } as never, {} as never)) as unknown[];
    expect(capped).toHaveLength(5);
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
      id: "act-old",
      type: "Run",
      startDate: new Date("2026-07-21T06:00:00.000Z"),
      distance: 10000,
      movingTime: 3000,
      averageHeartrate: 152,
      hrZones: null,
    },
    {
      id: "act-new",
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

/**
 * The variety engine in chat (issue #258).
 *
 * Asking the coach for "noget andet" used to return the same relaxed Zone 2 pas,
 * because `recommendWorkout` was the only session tool the model had. The chat
 * now exposes `buildNextActivity` — the Coach dashboard's "Næste aktivitet"
 * engine — so an alternative is a real, grounded prescription rather than the
 * model rewording the standard pas.
 *
 * The fixture is six weeks of ordinary easy running, every other day: long
 * enough that the acute load sits on its own chronic base (a short history
 * reads as an overload and answers "hvil" before the mix is ever consulted),
 * and a mix with no long tur and no quality at all — exactly the case the
 * variation exists for.
 */
describe("getNextActivity — the variety engine in chat (#258)", () => {
  /** Easy 8 km runs, every other day, newest 2 days before NOW. */
  const EASY_BASE: CoachChatActivity[] = Array.from({ length: 21 }, (_, i) => ({
    id: `easy-${i}`,
    type: "Run",
    startDate: new Date(NOW.getTime() - (2 + i * 2) * 24 * 60 * 60 * 1000),
    distance: 8000,
    movingTime: 2400,
    averageHeartrate: 142,
    hrZones: null,
  }));

  function build(activities: CoachChatActivity[] = EASY_BASE) {
    return buildCoachTools("user-1", NOW, { raceDate: null, raceName: null }, activities);
  }

  type Variation = {
    type: string;
    distanceKm: number;
    paceRange: { min: string; max: string };
    heartRateCap: number | null;
    basis: string;
    reason: string[];
  };

  it("is registered as a tool on the chat coach", () => {
    expect(build().getNextActivity).toBeTruthy();
  });

  it("returns a NextActivityView-shaped card grounded in the last five runs", async () => {
    const result = (await build().getNextActivity.execute?.(
      { reason: null } as never,
      {} as never
    )) as Variation;

    expect(["rest", "easy", "long", "fartlek", "intervals"]).toContain(result.type);
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.paceRange.min).toMatch(/^\d+:\d{2}$/);
    expect(result.paceRange.max).toMatch(/^\d+:\d{2}$/);
    // Grounded in the user's real history: the basis line counts the sampled
    // runs, so it can only come from the bound activities.
    expect(result.basis).toContain("Sidste 5 ture");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("prescribes the variation the mix lacks, not another easy run", async () => {
    const result = (await build().getNextActivity.execute?.({} as never, {} as never)) as Variation;
    // Five flat easy runs and no long tur — the variation must be the long
    // Zone 2 tur, which is precisely what the chat could not say before #258.
    expect(result.type).toBe("long");
  });

  it("is deterministic — same history and clock, same card", async () => {
    const first = await build().getNextActivity.execute?.({} as never, {} as never);
    const second = await build().getNextActivity.execute?.({} as never, {} as never);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  /**
   * Cross-tool coordination (#255) inside one chat turn. Sunday of the peak
   * phase (race two weeks out) is the one day the plan itself prescribes the
   * long tur — exactly the session this fixture's mix is missing — so the two
   * tools would otherwise name the same pas twice in the same answer.
   */
  it("steps aside when recommendWorkout already named that pas in the turn (#255)", async () => {
    const SUNDAY = new Date("2026-08-02T09:00:00.000Z");
    const RACE = new Date("2026-08-16T09:00:00.000Z");
    const history: CoachChatActivity[] = EASY_BASE.map((a, i) => ({
      ...a,
      startDate: new Date(SUNDAY.getTime() - (2 + i * 2) * 24 * 60 * 60 * 1000),
    }));
    const peak = () =>
      buildCoachTools("user-1", SUNDAY, { raceDate: RACE, raceName: "Testløb" }, history);

    // Asked on its own, the variation is the long tur the mix lacks.
    const solo = (await peak().getNextActivity.execute?.({} as never, {} as never)) as Variation;
    expect(solo.type).toBe("long");

    // Same turn, but the model asked for today's pas first — and the plan says
    // long tur too. The variation must then name a different session.
    const coordinated = peak();
    const workout = (await coordinated.recommendWorkout.execute?.({} as never, {} as never)) as {
      type: string;
    };
    expect(workout.type).toBe("long");
    const variation = (await coordinated.getNextActivity.execute?.(
      {} as never,
      {} as never
    )) as Variation;
    expect(variation.type).not.toBe(workout.type);
    expect(variation.reason.join(" ")).toContain("skal ikke sige det samme");
  });

  /**
   * A hviledag is a fact about today, not a de-dup preference (#260). The burn
   * phase runs mon/wed/fri/sun, so its Tuesday is a planned rest slot: the
   * variation must answer hvile there even in a turn where the model never
   * asked for today's pas, or chat contradicts the dashboard on the same day.
   */
  it("rests on a hviledag even when asked for the variation on its own (#260)", async () => {
    const RACE = new Date(2026, 8, 20);
    const dayIn = (jsWeekday: number): Date => {
      const d = new Date(buildPhases(RACE).burn.startDate);
      while (d.getDay() !== jsWeekday) d.setDate(d.getDate() + 1);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0);
    };
    const historyFor = (asOf: Date): CoachChatActivity[] =>
      EASY_BASE.map((a, i) => ({
        ...a,
        startDate: new Date(asOf.getTime() - (2 + i * 2) * 24 * 60 * 60 * 1000),
      }));
    const chatOn = (asOf: Date) =>
      buildCoachTools("user-1", asOf, { raceDate: RACE, raceName: "Testløb" }, historyFor(asOf));

    // Control: Wednesday is a run day in burn, and there the variation runs.
    const wednesday = dayIn(3);
    const onRunDay = (await chatOn(wednesday).getNextActivity.execute?.(
      {} as never,
      {} as never
    )) as Variation;
    expect(onRunDay.type).not.toBe("rest");

    const tuesday = dayIn(2);
    const pas = (await chatOn(tuesday).recommendWorkout.execute?.({} as never, {} as never)) as {
      type: string;
    };
    expect(pas.type).toBe("rest");

    // A fresh tool set — this turn the model asks for the variation only.
    const solo = (await chatOn(tuesday).getNextActivity.execute?.(
      {} as never,
      {} as never
    )) as Variation;
    expect(solo.type).toBe("rest");
    expect(solo.distanceKm).toBe(0);
    expect(solo.reason.join(" ")).toContain("hvile");
  });
});
