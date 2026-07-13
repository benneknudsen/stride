import { describe, expect, it } from "vitest";
import {
  buildPhases,
  DEFAULT_RACE_DATE,
  DEFAULT_RACE_NAME,
  getCurrentPhase,
  getWeekPlan,
  type PhaseKey,
  planTotalWeeks,
} from "@/lib/coach/engine";
import { buildHomeView, type HomeActivityLike } from "@/lib/cobalt/hjem";
import { buildPlanView } from "@/lib/cobalt/plan";
import { formatPaceRange, predictRace, zonePaces } from "@/lib/training/prediction";

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

describe("buildPlanView — this week's calendar", () => {
  // 6.–12. juli 2026 is a Monday-to-Sunday week, so index i is weekday i.
  const WEEK = [6, 7, 8, 9, 10, 11, 12].map((date) => new Date(2026, 6, date, 9, 0));
  const WEEKDAYS = ["MAN", "TIR", "ONS", "TOR", "FRE", "LØR", "SØN"];

  it.each(
    WEEK.map((now, i) => [WEEKDAYS[i], now, i] as const)
  )("marks %s as today — never a hardcoded Wednesday", (dow, now, index) => {
    const days = buildPlanView(undefined, now, RACE, RACE_NAME).days;
    expect(days.filter((d) => d.dow.includes("I DAG"))).toHaveLength(1);
    expect(days[index].dow).toBe(`${dow} · I DAG`);
    // Friday is a rest day: it reads "I DAG" but stays a rest tile.
    expect(days[index].kind).toBe(dow === "FRE" ? "rest" : "today");
  });

  it("completes the days behind us and leaves the rest prescribed", () => {
    // Thursday: Mon–Wed are behind us, Fri onwards is not.
    const days = buildPlanView(undefined, WEEK[3], RACE, RACE_NAME).days;
    expect(days.slice(0, 3).map((d) => d.kind)).toEqual(["done", "done", "done"]);
    expect(days.slice(4).map((d) => d.kind)).toEqual(["rest", "planned", "planned"]);
  });

  it("reports a pace for a session that's been run and a target for one that hasn't", () => {
    // Tuesday's tempo run: a result on Wednesday, a target on Monday.
    expect(buildPlanView(undefined, WEEK[2], RACE, RACE_NAME).days[1].meta).toBe("4:27 /km");
    expect(buildPlanView(undefined, WEEK[0], RACE, RACE_NAME).days[1].meta).toBe("MÅL 4:20–4:35");
  });

  it("counts only completed days into the week's volume", () => {
    const monday = buildPlanView(undefined, WEEK[0], RACE, RACE_NAME);
    expect(monday.weekDoneKm).toBe(0);
    expect(monday.weekPlannedKm).toBe(53); // 5 + 10 + 8 + 6 + 24

    // Sunday: everything but the long run is done (Thursday's AI day and Friday's
    // rest day carry no distance).
    const sunday = buildPlanView(undefined, WEEK[6], RACE, RACE_NAME);
    expect(sunday.weekDoneKm).toBe(29); // 5 + 10 + 8 + 6
    expect(sunday.weekDoneKm).toBeLessThanOrEqual(sunday.weekPlannedKm);
  });
});

describe("buildPlanView — data-driven week (issue #115)", () => {
  // A Thursday inside the peak block: five run days, a mid-week tempo and a
  // Sunday long run — the richest week the engine prescribes.
  const PEAK_MID = midOf("peak");
  const LIVE_NOW = addDays(PEAK_MID, 3 - ((PEAK_MID.getDay() + 6) % 7));

  function liveRun(
    daysAgo: number,
    km: number,
    paceSecPerKm: number,
    hr: number
  ): HomeActivityLike {
    const startDate = addDays(LIVE_NOW, -daysAgo);
    startDate.setHours(7, 30, 0, 0);
    const distance = km * 1000;
    const movingTime = Math.round(km * paceSecPerKm);
    return {
      id: `run-${daysAgo}`,
      name: `Tur ${daysAgo}`,
      type: "Run",
      startDate,
      distance,
      movingTime,
      averageSpeed: distance / movingTime,
      averageHeartrate: hr,
      averageCadence: 88,
      totalElevationGain: 20,
    };
  }

  // Six weeks of training: a steady easy base, a hard 10 km to anchor the
  // prediction, and one run already logged this week (Monday, 3 days back).
  const RUNS: HomeActivityLike[] = [
    liveRun(3, 9, 330, 140), // this week's Monday — already run
    liveRun(6, 10, 270, 168), // last week's hard 10 km — the prediction's anchor
    liveRun(8, 16, 330, 150),
    liveRun(10, 8, 345, 138),
    liveRun(13, 9, 340, 142),
    liveRun(15, 14, 335, 148),
    liveRun(17, 8, 350, 136),
    liveRun(20, 10, 335, 144),
    liveRun(24, 12, 340, 146),
    liveRun(27, 8, 345, 138),
    liveRun(31, 15, 335, 150),
    liveRun(35, 9, 345, 140),
    liveRun(40, 10, 340, 142),
  ];

  const PREDICTION = predictRace(RUNS, LIVE_NOW);
  if (!PREDICTION) throw new Error("fixture must support a prediction");
  const PACES = zonePaces(PREDICTION);
  const SESSIONS = getWeekPlan(getCurrentPhase(LIVE_NOW, RACE), undefined, RACE, RACE_NAME);

  const live = () => buildPlanView(RUNS, LIVE_NOW, RACE, RACE_NAME, true);

  it("flags the week as data-driven and prescribes the phase engine's sessions", () => {
    const view = live();
    expect(view.dataDriven).toBe(true);
    // Wednesday is the peak block's tempo day, Sunday its long run.
    expect(SESSIONS[2].type).toBe("tempo");
    expect(SESSIONS[6].type).toBe("long");
    expect(view.days[2].name).toBe("Tempo");
    expect(view.days[6].name).toBe("Lang tur");
  });

  it("derives every pace target from the race predictor — no template text survives", () => {
    const view = live();
    // Thursday's `now`, so Wednesday's tempo and Sunday's long run are both
    // prescriptions, not results.
    expect(view.days[2].meta).toBe(`MÅL ${formatPaceRange(PACES.tempo)}`);
    expect(view.days[6].meta).toBe(`MÅL ${formatPaceRange(PACES.long)}`);
    // None of the template's hardcoded paces can appear.
    const metas = view.days.map((day) => day.meta).join(" ");
    expect(metas).not.toContain("6:00–6:20");
    expect(metas).not.toContain("4:20–4:35");
    expect(metas).not.toContain("UGENS NØGLEPAS");
  });

  it("reports what a run day actually did instead of what it was told to do", () => {
    const monday = live().days[0];
    expect(monday.kind).toBe("done");
    expect(monday.distance).toBe("9,0 km"); // the logged 9 km, not a prescription
    expect(monday.meta).toBe("5:30 /km"); // the pace it was actually run at
  });

  it("never prescribes more than the phase allows, nor more than +10% on last week", () => {
    const view = live();
    const prescribed = SESSIONS.reduce((sum, s) => sum + (s.distanceKm ?? 0), 0);
    expect(view.weekPlannedKm).toBeLessThanOrEqual(Math.round(prescribed));
    expect(view.weekPlannedKm).toBeGreaterThan(0);
    // Done km is the runner's real volume this week — the one logged 9 km run.
    expect(view.weekDoneKm).toBeCloseTo(9, 5);
  });

  it("derives the race card from the prediction, with the goal just above the estimate", () => {
    const view = live();
    expect(view.race.aiEstimate).not.toBe("3:41"); // the template's number
    expect(view.race.racePace).not.toBe("5:20");
    expect(view.goalLabel).toBe(`Mål under ${view.race.goalTime}`);
    // A goal you'd commit to: the estimate rounded up to the next 5 minutes.
    const minutes = (time: string) => {
      const [h, m] = time.split(":").map(Number);
      return h * 60 + m;
    };
    expect(minutes(view.race.goalTime)).toBeGreaterThanOrEqual(minutes(view.race.aiEstimate));
  });

  it("derives the upcoming weeks from the engine rather than a fixed 52/56/38", () => {
    const view = live();
    expect(view.upcomingWeeks).toHaveLength(3);
    for (const week of view.upcomingWeeks) {
      expect(week.km).toBeGreaterThan(0);
      expect(week.focus).not.toContain("8×1000 m"); // the template's copy
    }
    expect(view.upcomingWeeks.map((w) => w.week)).toEqual([
      view.weekOfPlan + 1,
      view.weekOfPlan + 2,
      view.weekOfPlan + 3,
    ]);
  });

  it("keeps the demo template for visitors — same call, live off", () => {
    const view = buildPlanView(RUNS, LIVE_NOW, RACE, RACE_NAME);
    expect(view.dataDriven).toBe(false);
    expect(view.days[0].name).toBe("Recovery Jog");
    expect(view.weekPlannedKm).toBe(53);
    expect(view.race.aiEstimate).toBe("3:41");
  });

  it("falls back to the template rather than inventing paces it can't predict", () => {
    // Only sub-5 km runs: nothing the predictor will anchor on.
    const tooShort = [liveRun(2, 3, 360, 140), liveRun(5, 4, 355, 138)];
    const view = buildPlanView(tooShort, LIVE_NOW, RACE, RACE_NAME, true);
    expect(view.dataDriven).toBe(false);
    expect(view.days[0].name).toBe("Recovery Jog");
    expect(view.race.aiEstimate).toBe("3:41");
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
