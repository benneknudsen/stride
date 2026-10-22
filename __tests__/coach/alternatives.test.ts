import { describe, expect, it } from "vitest";
import { buildWorkoutAlternatives } from "@/lib/coach/alternatives";
import {
  DEFAULT_RACE_DATE,
  getPhaseRules,
  validateWorkout,
  type WorkoutContext,
} from "@/lib/coach/engine";
import { PACE_RANGES, type WorkoutInput } from "@/lib/coach/recommender";
import { GOALS } from "@/lib/training/goals";
import type { ProgressionSnapshot } from "@/lib/training/progression";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// Two phases, both inside the default race's build: burn (6 Jul – 2 Aug 2026)
// requires Zone 2 and has no tempo session, sharpen (3 Aug – 23 Aug 2026) allows
// one. The pair separates "the engine forbids this" from "the engine advises
// against this".
const BURN_NOW = new Date(2026, 6, 15, 8, 0);
const SHARPEN_NOW = new Date(2026, 7, 5, 8, 0);

function snapshot(): ProgressionSnapshot {
  return {
    date: BURN_NOW,
    hasFullWindow: true,
    paceEfficiency: 4.2,
    hrStability: 85,
    trainingLoad: { acute: 30, chronic: 30, ratio: 1.0, risk: "optimal" },
    zone2Percent: 90,
    volumeKm: 120,
    readyToIncrease: false,
  };
}

/** The same workout input the recommender gets — the alternatives read it too. */
function input(overrides: Partial<WorkoutInput> = {}): WorkoutInput {
  return {
    userId: "runner-1",
    goal: GOALS.zone2,
    progression: snapshot(),
    // Four days back: past both the 24 h and the 48 h recovery window.
    lastRun: new Date(BURN_NOW.getTime() - 4 * DAY_MS),
    footballYesterday: false,
    ...overrides,
  };
}

describe("buildWorkoutAlternatives — which types are listed", () => {
  it("never lists the type today's own pas already is", () => {
    const types = buildWorkoutAlternatives(input(), BURN_NOW, "easy").map((a) => a.type);
    expect(types).toEqual(["tempo", "long"]);
  });

  it("lists the other two when today's pas is a tempo", () => {
    const types = buildWorkoutAlternatives(input(), BURN_NOW, "tempo").map((a) => a.type);
    expect(types).toEqual(["easy", "long"]);
  });

  it("lists all three when today's pas is hvile", () => {
    const types = buildWorkoutAlternatives(input(), BURN_NOW, "rest").map((a) => a.type);
    expect(types).toEqual(["easy", "tempo", "long"]);
  });
});

describe("buildWorkoutAlternatives — the engine judges, the module does not", () => {
  it("shows a hard-blocked type as blocked, with the engine's own message", () => {
    // Burn is a Zone 2 base block, so a Zone 4 tempo breaks the phase's ceiling.
    const tempo = buildWorkoutAlternatives(input(), BURN_NOW, "easy").find(
      (a) => a.type === "tempo"
    );

    expect(tempo?.status).toBe("blocked");
    expect(tempo?.issues[0]?.id).toBe("zone2-hr-ceiling");
    expect(tempo?.issues[0]?.message).toContain("overskrider Zone 2-loftet");
  });

  it("quotes the engine's message verbatim for the same context", () => {
    const context: WorkoutContext = {
      plannedDate: BURN_NOW,
      plannedType: "tempo",
      plannedDistanceKm: getPhaseRules("burn", DEFAULT_RACE_DATE).maxDistanceKm,
      plannedZone: 4,
      shoeType: "adios-pro-4",
      lastRunDate: input().lastRun,
      footballYesterday: false,
      phase: "burn",
      raceDate: DEFAULT_RACE_DATE,
    };
    const engine = validateWorkout(context);

    const tempo = buildWorkoutAlternatives(input(), BURN_NOW, "easy").find(
      (a) => a.type === "tempo"
    );

    expect(tempo?.issues[0]?.message).toBe(engine.issues[0]?.message);
    expect(tempo?.issues[0]?.suggestion).toBe(engine.issues[0]?.suggestion);
  });

  it("shows a type with only warnings as a warning, never as blocked", () => {
    // Sharpen allows a tempo; football yesterday is the engine's soft caution.
    const tempo = buildWorkoutAlternatives(
      input({
        lastRun: new Date(SHARPEN_NOW.getTime() - 4 * DAY_MS),
        footballYesterday: true,
      }),
      SHARPEN_NOW,
      "easy"
    ).find((a) => a.type === "tempo");

    expect(tempo?.status).toBe("warning");
    expect(tempo?.issues).toHaveLength(0);
    expect(tempo?.warnings[0]?.id).toBe("football-recovery");
    expect(tempo?.warnings[0]?.message).toContain("dagen efter fodbold");
  });

  it("shows an untouched type as allowed", () => {
    const long = buildWorkoutAlternatives(
      input({ lastRun: new Date(SHARPEN_NOW.getTime() - 4 * DAY_MS) }),
      SHARPEN_NOW,
      "easy"
    ).find((a) => a.type === "long");

    expect(long?.status).toBe("allowed");
    expect(long?.issues).toHaveLength(0);
    expect(long?.warnings).toHaveLength(0);
  });

  it("blocks every run type when the engine's recovery window is not met", () => {
    const alternatives = buildWorkoutAlternatives(
      input({ lastRun: new Date(SHARPEN_NOW.getTime() - 2 * HOUR_MS) }),
      SHARPEN_NOW,
      "rest"
    );

    for (const alternative of alternatives) {
      expect(alternative.status).toBe("blocked");
      expect(alternative.issues[0]?.id).toBe("recovery-window");
    }
    // The engine's own hours — 24 before a Zone 2 run, 48 before a hard one.
    expect(alternatives[0]?.issues[0]?.message).toContain(
      "under minimumet på 24 timers restitution"
    );
    expect(alternatives[1]?.issues[0]?.message).toContain(
      "under minimumet på 48 timers restitution"
    );
  });
});

describe("buildWorkoutAlternatives — nothing is invented", () => {
  it("takes distance and zone from the engine's own phase rules", () => {
    const rules = getPhaseRules("sharpen", DEFAULT_RACE_DATE);
    const alternatives = buildWorkoutAlternatives(
      input({ lastRun: new Date(SHARPEN_NOW.getTime() - 4 * DAY_MS) }),
      SHARPEN_NOW,
      "rest"
    );

    const easy = alternatives.find((a) => a.type === "easy");
    const tempo = alternatives.find((a) => a.type === "tempo");
    const long = alternatives.find((a) => a.type === "long");

    expect(easy?.distance).toEqual({ minKm: rules.minDistanceKm, maxKm: rules.maxDistanceKm });
    expect(easy?.zone).toBe(2);
    expect(tempo?.zone).toBe(4);
    // The long run is pinned to the phase's long-run ceiling.
    expect(long?.distance).toEqual({ minKm: rules.longRunMaxKm, maxKm: rules.longRunMaxKm });
  });

  it("takes the pace band from the recommender's own table", () => {
    const tempo = buildWorkoutAlternatives(input(), BURN_NOW, "easy").find(
      (a) => a.type === "tempo"
    );
    expect(tempo?.paceRange).toEqual(PACE_RANGES.tempo);
  });

  it("carries no field of its own beyond the engine's verdict", () => {
    // A recovery time can only ever appear inside the engine's own message —
    // there is no field here that could hold an invented one.
    const alternative = buildWorkoutAlternatives(
      input({ lastRun: new Date(SHARPEN_NOW.getTime() - 2 * HOUR_MS) }),
      SHARPEN_NOW,
      "rest"
    )[0];

    expect(Object.keys(alternative).sort()).toEqual([
      "distance",
      "issues",
      "label",
      "paceRange",
      "status",
      "type",
      "warnings",
      "zone",
    ]);
    for (const verdict of [...alternative.issues, ...alternative.warnings]) {
      expect(Object.keys(verdict).sort()).toEqual(["id", "label", "message", "suggestion"]);
    }
  });

  it("is JSON-serializable — no Date, no function", () => {
    const alternatives = buildWorkoutAlternatives(input(), BURN_NOW, "rest");
    const roundTrip = JSON.parse(JSON.stringify(alternatives));
    expect(roundTrip).toEqual(alternatives);
  });
});
