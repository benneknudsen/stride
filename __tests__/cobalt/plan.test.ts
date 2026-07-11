import { describe, expect, it } from "vitest";
import {
  buildPhases,
  DEFAULT_RACE_DATE,
  DEFAULT_RACE_NAME,
  type PhaseKey,
  planTotalWeeks,
} from "@/lib/coach/engine";
import { buildHomeView } from "@/lib/cobalt/hjem";
import { buildPlanView } from "@/lib/cobalt/plan";

// View-model tests for the race parameterisation (issue #99): the countdown,
// plan title and phase timeline must all re-anchor to an arbitrary race date,
// with the demo defaults intact when no race is passed. No fixture hardcodes a
// phase date — everything derives from the race under test via buildPhases.

const DAY_MS = 86_400_000;

/** `days` whole calendar days after `base`, at local midnight. */
function addDays(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

/** Whole calendar days from `a` to `b` (local midnights — leap/DST safe). */
function daysBetween(a: Date, b: Date): number {
  return Math.round((addDays(b, 0).getTime() - addDays(a, 0).getTime()) / DAY_MS);
}

const RACE = new Date(2027, 9, 10); // an arbitrary non-default race
const RACE_NAME = "CPH Half";
const PHASES = buildPhases(RACE);
const SEQUENCE: PhaseKey[] = ["adapt", "burn", "sharpen", "peak", "taper"];
const PLAN_DAYS = daysBetween(PHASES.adapt.startDate, PHASES.taper.endDate);

/** A date roughly in the middle of a phase's window. */
function midOf(phase: PhaseKey): Date {
  const rules = PHASES[phase];
  return addDays(rules.startDate, Math.floor(daysBetween(rules.startDate, rules.endDate) / 2));
}

describe("buildHomeView — race parameter", () => {
  it("threads the race name into the plan strip title", () => {
    const view = buildHomeView(undefined, midOf("burn"), RACE, RACE_NAME);
    expect(view.plan.raceName).toBe(RACE_NAME);
    expect(view.plan.planTitle).toBe(`Træningsplan · ${RACE_NAME}`);
  });

  it("counts down in whole calendar days, immune to boundary evenings", () => {
    // 23:30 the evening before the race is still 1 day out, not 0.
    const eveningBefore = new Date(RACE.getFullYear(), RACE.getMonth(), RACE.getDate() - 1, 23, 30);
    expect(buildHomeView(undefined, eveningBefore, RACE, RACE_NAME).plan.daysToRace).toBe(1);
  });

  it("reads 0 days on race day itself without flagging the race as passed", () => {
    const raceMorning = new Date(RACE.getFullYear(), RACE.getMonth(), RACE.getDate(), 9, 0);
    const plan = buildHomeView(undefined, raceMorning, RACE, RACE_NAME).plan;
    expect(plan.daysToRace).toBe(0);
    expect(plan.racePassed).toBe(false);
  });

  it("flags the race as passed the day after, clamping the countdown to 0", () => {
    const plan = buildHomeView(undefined, addDays(RACE, 1), RACE, RACE_NAME).plan;
    expect(plan.daysToRace).toBe(0);
    expect(plan.racePassed).toBe(true);
  });

  it("clamps week-of-plan into [1, totalWeeks] with race week as the final week", () => {
    const total = planTotalWeeks(RACE);
    // Race tomorrow → the plan's final week.
    const tomorrow = buildHomeView(undefined, addDays(RACE, -1), RACE, RACE_NAME).plan;
    expect(tomorrow.weekOfPlan).toBe(total);
    expect(tomorrow.totalWeeks).toBe(total);
    // Well before the build → clamped to week 1.
    const prePlan = buildHomeView(
      undefined,
      addDays(PHASES.adapt.startDate, -30),
      RACE,
      RACE_NAME
    ).plan;
    expect(prePlan.weekOfPlan).toBe(1);
  });

  it("derives progress from the derived total, not a hardcoded 38", () => {
    const plan = buildHomeView(undefined, midOf("burn"), RACE, RACE_NAME).plan;
    expect(plan.totalWeeks).toBe(planTotalWeeks(RACE));
    expect(plan.progressPct).toBe(Math.round((plan.weekOfPlan / plan.totalWeeks) * 100));
  });
});

describe("buildPlanView — phase timeline derived from buildPhases", () => {
  it("places one marker per phase at its boundary's share of the build, plus the race", () => {
    const view = buildPlanView(undefined, midOf("sharpen"), RACE, RACE_NAME);
    expect(view.phaseMarkers).toHaveLength(SEQUENCE.length + 1);
    SEQUENCE.forEach((key, i) => {
      const expected = daysBetween(PHASES.adapt.startDate, PHASES[key].startDate) / PLAN_DAYS;
      expect(view.phaseMarkers[i].position).toBeCloseTo(expected, 10);
    });
    const race = view.phaseMarkers.at(-1);
    expect(race?.position).toBe(1);
    expect(race?.state).toBe("race");
  });

  it.each(SEQUENCE)("marks earlier phases done and later ones upcoming from mid-%s", (phase) => {
    const view = buildPlanView(undefined, midOf(phase), RACE, RACE_NAME);
    const active = SEQUENCE.indexOf(phase);
    SEQUENCE.forEach((key, i) => {
      const expected = i < active ? "done" : i === active ? "active" : "upcoming";
      expect(view.phaseMarkers[i].state, key).toBe(expected);
      expect(view.phaseSegments[i].fill, key).toBe(expected);
    });
  });

  it("labels the active phase '· nu' and completed phases '✓'", () => {
    const view = buildPlanView(undefined, midOf("sharpen"), RACE, RACE_NAME);
    expect(view.phaseMarkers[0].label).toBe("Adapt ✓");
    expect(view.phaseMarkers[1].label).toBe("Burn ✓");
    expect(view.phaseMarkers[2].label).toBe("Sharpen · nu");
    expect(view.phaseMarkers[3].label).toBe("Peak");
  });

  it("sizes each segment by the phase's length in days", () => {
    const view = buildPlanView(undefined, midOf("burn"), RACE, RACE_NAME);
    SEQUENCE.forEach((key, i) => {
      const days = daysBetween(PHASES[key].startDate, PHASES[key].endDate) + 1;
      expect(view.phaseSegments[i].id).toBe(key);
      expect(view.phaseSegments[i].flex).toBe(days);
    });
  });
});

describe("buildPlanView — race card & states", () => {
  it("threads the race name, title and date-input value through", () => {
    const view = buildPlanView(undefined, midOf("burn"), RACE, RACE_NAME);
    expect(view.race.name).toBe(RACE_NAME);
    expect(view.planTitle).toBe(`Træningsplan · ${RACE_NAME}`);
    expect(view.race.dateValue).toBe("2027-10-10");
  });

  it("handles race tomorrow: 1 day out, final plan week, taper active", () => {
    const view = buildPlanView(undefined, addDays(RACE, -1), RACE, RACE_NAME);
    expect(view.daysToRace).toBe(1);
    expect(view.weekOfPlan).toBe(view.totalWeeks);
    expect(view.racePassed).toBe(false);
    expect(view.phaseSegments.at(-1)?.fill).toBe("active");
  });

  it("flags a passed race so the page can show the next-race CTA", () => {
    const view = buildPlanView(undefined, addDays(RACE, 14), RACE, RACE_NAME);
    expect(view.racePassed).toBe(true);
    expect(view.daysToRace).toBe(0);
  });

  it("falls back to the demo race when no race is passed", () => {
    // `now` must sit inside the DEFAULT race's build, not the 2027 one's.
    const defaultBurn = buildPhases(DEFAULT_RACE_DATE).burn;
    const view = buildPlanView(undefined, addDays(defaultBurn.startDate, 10));
    expect(view.race.name).toBe(DEFAULT_RACE_NAME);
    expect(view.totalWeeks).toBe(planTotalWeeks());
    expect(view.racePassed).toBe(false);
  });
});
