import { describe, expect, it } from "vitest";
import {
  buildPhases,
  DEFAULT_RACE_DATE,
  DEFAULT_RACE_NAME,
  getCurrentPhase,
  getPhaseRules,
  getWeekPlan,
  type PhaseKey,
  planTotalWeeks,
} from "@/lib/coach/engine";
import { buildHomeView, type HomeActivityLike } from "@/lib/cobalt/hjem";
import { buildPlanView, getPlanSuggestions, type RunSuggestion } from "@/lib/cobalt/plan";
import { formatPaceClock, predictRace, zonePaces } from "@/lib/training/prediction";

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

/** Prescribed distances sit on a half-km grid — mirrors the view-model. */
function roundHalf(km: number): number {
  return Math.round(km * 2) / 2;
}

/** Default half-width of a pace range, in seconds — mirrors the view-model. */
const SPREAD = 10;
const LOW_CONFIDENCE_SPREAD = 25;

/** The formatted fast→slow pace range the view-model builds for a zone pace. */
function rangeFor(secondsPerKm: number, spread: number = SPREAD): { min: string; max: string } {
  return {
    min: formatPaceClock(secondsPerKm - spread),
    max: formatPaceClock(secondsPerKm + spread),
  };
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

/** The three suggestions keyed by type — every plan view returns exactly one of each. */
function byType(suggestions: RunSuggestion[]): Record<RunSuggestion["type"], RunSuggestion> {
  const map = {} as Record<RunSuggestion["type"], RunSuggestion>;
  for (const s of suggestions) map[s.type] = s;
  return map;
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

describe("buildPlanView — this week's run suggestions (issue #244)", () => {
  // Peak is the richest block: a mid-week tempo and a Sunday long run, so all
  // three suggestion types carry their most distinctive distances.
  const NOW = midOf("peak");

  it("returns exactly three suggestions — one easy, one quality, one long", () => {
    const { suggestions } = buildPlanView(undefined, NOW, RACE, RACE_NAME);
    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((s) => s.type)).toEqual(["easy", "tempo", "long"]);
    // Danish, day-agnostic labels — never a weekday.
    expect(suggestions.map((s) => s.label)).toEqual(["Let pas", "Kvalitetspas", "Langtur"]);
  });

  it("takes each distance from the phase rules, not a day slot", () => {
    const rules = getPhaseRules("peak", RACE);
    const { easy, tempo, long } = byType(
      buildPlanView(undefined, NOW, RACE, RACE_NAME).suggestions
    );
    expect(easy.distanceKm).toBe(roundHalf((rules.minDistanceKm + rules.maxDistanceKm) / 2));
    expect(tempo.distanceKm).toBe(rules.maxDistanceKm);
    expect(long.distanceKm).toBe(rules.longRunMaxKm);
  });

  it("sums the week's suggested volume from the phase's prescription", () => {
    const view = buildPlanView(undefined, NOW, RACE, RACE_NAME);
    const sessions = getWeekPlan(
      getCurrentPhase(NOW, RACE),
      // Any Monday in the phase — the template path is unscaled.
      addDays(NOW, -((NOW.getDay() + 6) % 7)),
      RACE,
      RACE_NAME
    );
    const km = Math.round(sessions.reduce((sum, s) => sum + (s.distanceKm ?? 0), 0));
    expect(view.weekKm).toBe(km);
    expect(view.weekKm).toBeGreaterThan(0);
  });

  it("carries the current phase label and the live race countdown", () => {
    const view = buildPlanView(undefined, NOW, RACE, RACE_NAME);
    expect(view.phaseLabel).toBe("Peak");
    expect(view.daysToRace).toBe(buildHomeView(undefined, NOW, RACE, RACE_NAME).plan.daysToRace);
  });

  it("keeps the demo (template) paces for a visitor — live off", () => {
    const view = buildPlanView(undefined, NOW, RACE, RACE_NAME);
    expect(view.dataDriven).toBe(false);
    // The fallback grid is deterministic, so the ordering easy > tempo holds:
    // a quality pace is faster (fewer seconds) than an easy one.
    const { easy, tempo, long } = byType(view.suggestions);
    const secs = (m: string) => Number(m.split(":")[0]) * 60 + Number(m.split(":")[1]);
    expect(secs(tempo.paceRange.min)).toBeLessThan(secs(easy.paceRange.min));
    expect(secs(long.paceRange.min)).toBeLessThan(secs(easy.paceRange.min));
  });
});

describe("buildPlanView — data-driven suggestions (issue #115)", () => {
  // A runner mid-peak with a real prediction: five run days, a tempo and a long.
  const NOW = midOf("peak");

  function liveRun(
    daysAgo: number,
    km: number,
    paceSecPerKm: number,
    hr: number
  ): HomeActivityLike {
    const startDate = addDays(NOW, -daysAgo);
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

  // Six weeks of training: a steady easy base plus a hard 10 km to anchor the
  // prediction, all carrying heart rate so the grid can floor on observed easy pace.
  const RUNS: HomeActivityLike[] = [
    liveRun(6, 10, 270, 168),
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

  const PREDICTION = predictRace(RUNS, NOW).prediction;
  if (!PREDICTION) throw new Error("fixture must support a prediction");
  const PACES = zonePaces(PREDICTION);

  const live = () => buildPlanView(RUNS, NOW, RACE, RACE_NAME, true);

  it("flags the plan as data-driven", () => {
    expect(live().dataDriven).toBe(true);
  });

  it("derives every suggestion pace from the race predictor's zone grid", () => {
    const { easy, tempo, long } = byType(live().suggestions);
    expect(easy.paceRange).toEqual(rangeFor(PACES.easy));
    expect(tempo.paceRange).toEqual(rangeFor(PACES.tempo));
    expect(long.paceRange).toEqual(rangeFor(PACES.long));
  });

  it("caps the suggested volume at the phase prescription, scaled by load", () => {
    const view = live();
    const sessions = getWeekPlan(getCurrentPhase(NOW, RACE), undefined, RACE, RACE_NAME);
    const prescribed = Math.round(sessions.reduce((sum, s) => sum + (s.distanceKm ?? 0), 0));
    expect(view.weekKm).toBeLessThanOrEqual(prescribed);
    expect(view.weekKm).toBeGreaterThan(0);
  });

  it("derives the race card from the prediction, with the goal just above the estimate", () => {
    const view = live();
    expect(view.race.aiEstimate).not.toBe("3:41"); // the template's number
    expect(view.race.racePace).not.toBe("5:20");
    expect(view.goalLabel).toBe(`Mål under ${view.race.goalTime}`);
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
      expect(week.sessions.length).toBeGreaterThan(0);
    }
    expect(view.upcomingWeeks.map((w) => w.week)).toEqual([
      view.weekOfPlan + 1,
      view.weekOfPlan + 2,
      view.weekOfPlan + 3,
    ]);
  });

  it("keeps the demo template for visitors — same call, live off", () => {
    const view = buildPlanView(RUNS, NOW, RACE, RACE_NAME);
    expect(view.dataDriven).toBe(false);
    expect(view.race.aiEstimate).toBe("3:41");
    expect(view.race.lock).toBeNull();
  });

  it("measures the runner's effort against the max HR it's handed (issue #116)", () => {
    // Told the runner's real ceiling is 200, the anchor's effort discount turns the
    // estimate — and every derived pace — more cautious. The long suggestion is a
    // stable probe: it's prescribed in both views.
    const observed = byType(buildPlanView(RUNS, NOW, RACE, RACE_NAME, true).suggestions);
    const withHrMax = byType(buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, 200).suggestions);
    expect(withHrMax.long.paceRange).not.toEqual(observed.long.paceRange);
  });
});

describe("buildPlanView — locked race card (issue #117)", () => {
  // Inside the race's own build, so the phase engine has suggestions to show.
  const NOW = midOf("burn");

  function liveRun(daysAgo: number, km: number, paceSecPerKm: number): HomeActivityLike {
    const startDate = addDays(NOW, -daysAgo);
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
      averageHeartrate: 140,
      averageCadence: 88,
      totalElevationGain: 10,
    };
  }

  it("locks the estimate — with the reason — when the runner has no runs at all", () => {
    const view = buildPlanView([], NOW, RACE, RACE_NAME, true);
    expect(view.dataDriven).toBe(false);
    expect(view.race.lock?.reason).toBe("no-runs");
    expect(view.race.lock?.message).toMatch(/Strava/);
  });

  it("locks it when every run is too short to anchor a prediction", () => {
    const view = buildPlanView(
      [liveRun(2, 3, 360), liveRun(5, 4, 355)],
      NOW,
      RACE,
      RACE_NAME,
      true
    );
    expect(view.dataDriven).toBe(false);
    expect(view.race.lock?.reason).toBe("runs-too-short");
    expect(view.race.lock?.requiredKm).toBe(5.5);
    expect(view.race.lock?.message).toContain("5,5 km");
    // The template's suggestions still stand in — only the race numbers are withheld.
    expect(view.suggestions).toHaveLength(3);
    expect(view.suggestions.map((s) => s.type)).toEqual(["easy", "tempo", "long"]);
  });

  it("locks it when the runs are all older than the lookback window", () => {
    const view = buildPlanView([liveRun(200, 12, 320)], NOW, RACE, RACE_NAME, true);
    expect(view.race.lock?.reason).toBe("stale-runs");
  });

  it("never headlines a locked plan with the demo's goal time", () => {
    const view = buildPlanView([], NOW, RACE, RACE_NAME, true);
    expect(view.goalLabel).not.toContain("3:45");
  });

  it("unlocks the card the moment there's something to predict from", () => {
    const view = buildPlanView([liveRun(3, 10, 270)], NOW, RACE, RACE_NAME, true);
    expect(view.dataDriven).toBe(true);
    expect(view.race.lock).toBeNull();
    expect(view.race.aiEstimate).not.toBe("3:41");
  });
});

describe("buildPlanView — honest uncertainty at low confidence (issue #231)", () => {
  const NOW = midOf("burn");

  function liveRun(
    daysAgo: number,
    km: number,
    paceSecPerKm: number,
    hr: number
  ): HomeActivityLike {
    const startDate = addDays(NOW, -daysAgo);
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
      totalElevationGain: 10,
    };
  }

  /** The width (seconds) of a suggestion's fast→slow pace range. */
  function rangeWidth(suggestion: RunSuggestion): number {
    const secs = (m: string) => Number(m.split(":")[0]) * 60 + Number(m.split(":")[1]);
    return secs(suggestion.paceRange.max) - secs(suggestion.paceRange.min);
  }

  it("widens the pace range when the prediction rests on a single run", () => {
    const prediction = predictRace([liveRun(3, 8, 330, 140)], NOW).prediction;
    expect(prediction?.confidence).toBe("low");

    const view = buildPlanView([liveRun(3, 8, 330, 140)], NOW, RACE, RACE_NAME, true);
    for (const suggestion of view.suggestions) {
      expect(rangeWidth(suggestion)).toBe(LOW_CONFIDENCE_SPREAD * 2);
    }
  });

  it("keeps a tight range when the prediction is well-founded", () => {
    const runs = [
      liveRun(2, 18, 300, 165),
      liveRun(5, 10, 320, 150),
      liveRun(8, 12, 330, 148),
      liveRun(11, 9, 335, 145),
      liveRun(14, 10, 330, 146),
      liveRun(17, 8, 340, 142),
    ];
    expect(predictRace(runs, NOW).prediction?.confidence).toBe("high");

    const view = buildPlanView(runs, NOW, RACE, RACE_NAME, true);
    for (const suggestion of view.suggestions) {
      expect(rangeWidth(suggestion)).toBe(SPREAD * 2);
    }
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
    const defaultBurn = buildPhases(DEFAULT_RACE_DATE).burn;
    const view = buildPlanView(undefined, addDays(defaultBurn.startDate, 10));
    expect(view.race.name).toBe(DEFAULT_RACE_NAME);
    expect(view.totalWeeks).toBe(planTotalWeeks());
    expect(view.racePassed).toBe(false);
  });
});

describe("buildPlanView — race distance + goal (issue #238)", () => {
  const NOW = midOf("burn");

  function liveRun(
    daysAgo: number,
    km: number,
    paceSecPerKm: number,
    hr: number
  ): HomeActivityLike {
    const startDate = addDays(NOW, -daysAgo);
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
      totalElevationGain: 15,
    };
  }

  const RUNS: HomeActivityLike[] = [
    liveRun(6, 10, 270, 168),
    liveRun(9, 12, 330, 148),
    liveRun(13, 9, 335, 145),
    liveRun(17, 10, 330, 146),
    liveRun(24, 8, 340, 142),
    liveRun(31, 15, 335, 150),
  ];

  const seconds = (time: string) => {
    const parts = time.split(":").map(Number);
    return parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 3600 + parts[1] * 60;
  };

  it("targets the chosen distance, not the half-marathon default", () => {
    const tenK = buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, null, 10);
    const half = buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, null, 21.0975);
    expect(seconds(tenK.race.aiEstimate)).toBeLessThan(seconds(half.race.aiEstimate));
    expect(tenK.race.distanceKm).toBe(10);
  });

  it("shows the runner's own goal as the headline and race pace, keeping the estimate", () => {
    const view = buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, null, 10, 2400);
    expect(view.race.goalTime).toBe("40:00");
    expect(view.race.racePace).toBe(formatPaceClock(240));
    expect(view.goalLabel).toBe("Mål under 40:00");
    expect(view.race.goalTimeSeconds).toBe(2400);
    expect(view.race.distanceKm).toBe(10);
    expect(view.race.aiEstimate).not.toBe(view.race.goalTime);
  });

  it("anchors the quality suggestion on goal pace when a goal is set", () => {
    // Runs that carry easy heart-rate data, so the predictor observes an easy pace
    // and the goal legitimately anchors the whole grid, floored against it (#231).
    const hrRuns: HomeActivityLike[] = [
      liveRun(6, 10, 265, 175),
      liveRun(9, 12, 338, 135),
      liveRun(13, 9, 340, 132),
      liveRun(17, 10, 336, 134),
      liveRun(24, 8, 342, 130),
      liveRun(31, 15, 337, 138),
    ];
    const withGoal = buildPlanView(hrRuns, NOW, RACE, RACE_NAME, true, null, 10, 2400);
    const withoutGoal = buildPlanView(hrRuns, NOW, RACE, RACE_NAME, true, null, 10);
    // Ambitious goal pace pulls the quality target faster than the pure prediction.
    expect(byType(withGoal.suggestions).tempo.paceRange).not.toEqual(
      byType(withoutGoal.suggestions).tempo.paceRange
    );
  });

  it("keeps the prediction-derived goal when no goal is set (old behavior)", () => {
    const view = buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, null, 10);
    expect(view.race.goalTimeSeconds).toBeNull();
    expect(view.goalLabel).toBe(`Mål under ${view.race.goalTime}`);
  });

  it("keeps the demo numbers for a visitor with no race at all", () => {
    const view = buildPlanView(undefined, NOW, RACE, RACE_NAME);
    expect(view.race.goalTime).toBe("3:45");
    expect(view.race.racePace).toBe("5:20");
    expect(view.race.aiEstimate).toBe("3:41");
    expect(view.race.distanceKm).toBeNull();
    expect(view.race.goalTimeSeconds).toBeNull();
  });
});

describe("buildPlanView — goal pace stays grounded without easy data (issue #242)", () => {
  // The common live case: Strava runs with no heart rate, so the predictor has no
  // observed easy pace to floor the grid against (#231's floor is null).
  const NOW = midOf("peak");

  function noHrRun(daysAgo: number, km: number, paceSecPerKm: number): HomeActivityLike {
    const startDate = addDays(NOW, -daysAgo);
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
      averageHeartrate: null,
      averageCadence: 88,
      totalElevationGain: 15,
    };
  }

  const RUNS: HomeActivityLike[] = [
    noHrRun(8, 10, 270),
    noHrRun(11, 12, 330),
    noHrRun(15, 9, 335),
    noHrRun(19, 10, 330),
    noHrRun(26, 8, 340),
    noHrRun(33, 15, 335),
  ];

  const GOAL_10K = 2400; // 40:00 over 10 km → 4:00 /km, faster than the ~45:00 predicted.

  const PREDICTION = predictRace(RUNS, NOW, 10).prediction;
  if (!PREDICTION) throw new Error("fixture must support a prediction");
  const GROUNDED = zonePaces(PREDICTION);
  const GOAL_GRID = zonePaces({ ...PREDICTION, paceSecPerKm: Math.round(GOAL_10K / 10) });

  const withGoal = buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, null, 10, GOAL_10K);
  const withoutGoal = buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, null, 10);

  it("has no observed easy pace to floor against — and the goal is genuinely faster", () => {
    expect(PREDICTION.observedEasyPaceSecPerKm).toBeNull();
    expect(GOAL_GRID.easy).toBeLessThan(GROUNDED.easy);
  });

  it("keeps the easy and long suggestions on the prediction, not the aspirational goal", () => {
    const { easy, long } = byType(withGoal.suggestions);
    // Identical to the no-goal plan — never dragged up to goal pace.
    const plain = byType(withoutGoal.suggestions);
    expect(easy.paceRange).toEqual(plain.easy.paceRange);
    expect(long.paceRange).toEqual(plain.long.paceRange);
    // Concretely: on the grounded pace, not the faster goal pace.
    expect(long.paceRange).toEqual(rangeFor(GROUNDED.long));
    expect(long.paceRange).not.toEqual(rangeFor(GOAL_GRID.long));
  });

  it("still trains the quality suggestion toward the goal", () => {
    const tempo = byType(withGoal.suggestions).tempo;
    expect(tempo.paceRange).toEqual(rangeFor(GOAL_GRID.tempo));
    expect(tempo.paceRange).not.toEqual(rangeFor(GROUNDED.tempo));
    // The race card keeps goal pace too — the race-card path is untouched (#238).
    expect(withGoal.race.racePace).toBe(formatPaceClock(Math.round(GOAL_10K / 10)));
  });

  it("leaves the grid on the pure prediction when no goal is set", () => {
    const { long, tempo } = byType(withoutGoal.suggestions);
    expect(long.paceRange).toEqual(rangeFor(GROUNDED.long));
    expect(tempo.paceRange).toEqual(rangeFor(GROUNDED.tempo));
    expect(withoutGoal.race.goalTimeSeconds).toBeNull();
  });

  it("still floors the grid on observed easy pace when heart rate is present (#231 intact)", () => {
    const hrRuns: HomeActivityLike[] = [
      { ...noHrRun(8, 10, 265), averageHeartrate: 175 },
      { ...noHrRun(11, 12, 340), averageHeartrate: 135 },
      { ...noHrRun(15, 9, 345), averageHeartrate: 132 },
      { ...noHrRun(19, 10, 340), averageHeartrate: 134 },
      { ...noHrRun(26, 8, 350), averageHeartrate: 130 },
      { ...noHrRun(33, 15, 338), averageHeartrate: 138 },
    ];
    const pred = predictRace(hrRuns, NOW, 10).prediction;
    if (!pred) throw new Error("fixture must support a prediction");
    expect(pred.observedEasyPaceSecPerKm).not.toBeNull();
    const expected = zonePaces({ ...pred, paceSecPerKm: Math.round(GOAL_10K / 10) });

    const view = buildPlanView(hrRuns, NOW, RACE, RACE_NAME, true, null, 10, GOAL_10K);
    const { tempo, long } = byType(view.suggestions);
    expect(tempo.paceRange).toEqual(rangeFor(expected.tempo));
    expect(long.paceRange).toEqual(rangeFor(expected.long));
  });
});

describe("getPlanSuggestions — coach-facing suggestions (issue #244)", () => {
  const NOW = midOf("peak");

  function liveRun(daysAgo: number, km: number, paceSecPerKm: number, hr: number) {
    const startDate = addDays(NOW, -daysAgo);
    startDate.setHours(7, 30, 0, 0);
    const distance = km * 1000;
    const movingTime = Math.round(km * paceSecPerKm);
    return {
      type: "Run",
      distance,
      movingTime,
      startDate,
      averageHeartrate: hr,
    };
  }

  const RUNS = [
    liveRun(6, 10, 270, 168),
    liveRun(9, 12, 330, 148),
    liveRun(13, 9, 335, 145),
    liveRun(17, 10, 330, 146),
    liveRun(24, 8, 340, 142),
    liveRun(31, 15, 335, 150),
  ];

  it("returns the same three suggestions the plan page shows, marked data-driven", () => {
    const result = getPlanSuggestions(RUNS, NOW, RACE, RACE_NAME);
    expect(result.suggestions.map((s) => s.type)).toEqual(["easy", "tempo", "long"]);
    expect(result.phase).toBe("peak");
    expect(result.phaseLabel).toBe("Peak");
    expect(result.weekKm).toBeGreaterThan(0);
    expect(result.dataDriven).toBe(true);

    // The paces match the plan view's derived grid for the same runs.
    const prediction = predictRace(RUNS, NOW).prediction;
    if (!prediction) throw new Error("fixture must support a prediction");
    const paces = zonePaces(prediction);
    expect(byType(result.suggestions).tempo.paceRange).toEqual(rangeFor(paces.tempo));
  });

  it("falls back to the demo grid when there is nothing to predict from", () => {
    const result = getPlanSuggestions([], NOW, RACE, RACE_NAME);
    expect(result.dataDriven).toBe(false);
    expect(result.suggestions).toHaveLength(3);
  });
});

describe("buildPlanView — Kommende uger, phase-aware (issue #237)", () => {
  const UI_PHASE: Record<PhaseKey, string> = {
    adapt: "Adapt",
    burn: "Burn",
    sharpen: "Sharpen",
    peak: "Peak",
    taper: "Nedtrapning",
  };

  function trainingWeekMonday(now: Date): Date {
    return addDays(now, -((now.getDay() + 6) % 7));
  }

  it("derives the template path's rows from the phase engine, not a frozen 52/56/38", () => {
    const now = midOf("sharpen");
    const view = buildPlanView(undefined, now, RACE, RACE_NAME);
    expect(view.dataDriven).toBe(false);
    expect(view.upcomingWeeks).toHaveLength(3);

    const monday = trainingWeekMonday(now);
    view.upcomingWeeks.forEach((week, i) => {
      const start = addDays(monday, (i + 1) * 7);
      const phase = getCurrentPhase(start, RACE);
      const sessions = getWeekPlan(phase, start, RACE, RACE_NAME);
      const km = Math.round(sessions.reduce((sum, s) => sum + (s.distanceKm ?? 0), 0));
      expect(week.week).toBe(view.weekOfPlan + i + 1);
      expect(week.km).toBe(km);
      expect(week.phaseLabel).toBe(UI_PHASE[phase]);
      expect(week.muted).toBe(phase === "taper");

      // Every row says what the week actually asks for: the dates it covers,
      // the runs it prescribes with distances and paces, and how the volume
      // moves — the old single prose line said none of it.
      expect(week.dateRange).toMatch(/\d+\.[–.]/);
      expect(week.runCount).toBe(sessions.filter((session) => session.type !== "rest").length);
      expect(week.sessions.length).toBeGreaterThan(0);
      for (const session of week.sessions) {
        expect(session.distance).toMatch(/^\d+(,\d)? km$/);
        if (session.pace) expect(session.pace).toMatch(/^\d+:\d{2} \/km$/);
      }
    });

    // Deltas chain: each row's delta is its km minus the previous row's.
    view.upcomingWeeks.forEach((week, i) => {
      if (i === 0) return;
      expect(week.deltaKm).toBe(week.km - view.upcomingWeeks[i - 1].km);
    });
  });

  it("differentiates consecutive weeks that fall in the same phase", () => {
    const now = addDays(RACE, -75);
    const monday = trainingWeekMonday(now);
    const phases = [1, 2, 3].map((o) => getCurrentPhase(addDays(monday, o * 7), RACE));
    expect(new Set(phases).size).toBe(1);
    expect(phases[0]).toBe("burn");

    const view = buildPlanView(undefined, now, RACE, RACE_NAME);
    // Same phase three weeks running — the rows still differ: distinct calendar
    // dates and a week-in-block count that advances.
    const dates = view.upcomingWeeks.map((w) => w.dateRange);
    expect(new Set(dates).size).toBe(dates.length);
    const progress = view.upcomingWeeks.map((w) => w.phaseProgress);
    expect(new Set(progress).size).toBe(progress.length);
  });

  it("lets a phase change show through across the window", () => {
    const now = addDays(RACE, -62);
    const monday = trainingWeekMonday(now);
    const phases = [1, 2, 3].map((o) => getCurrentPhase(addDays(monday, o * 7), RACE));
    expect(new Set(phases).size).toBeGreaterThan(1);

    const view = buildPlanView(undefined, now, RACE, RACE_NAME);
    for (let i = 1; i < 3; i++) {
      if (phases[i] !== phases[i - 1]) {
        expect(view.upcomingWeeks[i].phaseLabel).not.toBe(view.upcomingWeeks[i - 1].phaseLabel);
      }
    }
    expect(new Set(view.upcomingWeeks.map((w) => w.dateRange)).size).toBe(3);
  });

  it("reads any taper week muted with the nedtrapning copy", () => {
    const RACE_SAT = new Date(2027, 9, 9);
    let sawTaper = false;
    for (let off = 10; off <= 14; off++) {
      const now = addDays(RACE_SAT, -off);
      const view = buildPlanView(undefined, now, RACE_SAT, "CPH Half");
      const monday = trainingWeekMonday(now);
      view.upcomingWeeks.forEach((week, i) => {
        const phase = getCurrentPhase(addDays(monday, (i + 1) * 7), RACE_SAT);
        expect(week.muted).toBe(phase === "taper");
        if (phase === "taper") {
          sawTaper = true;
          expect(week.phaseLabel).toBe("Nedtrapning");
        }
      });
    }
    expect(sawTaper).toBe(true);
  });

  it("keeps the derived (live) path's rows phase-aware and distinct", () => {
    const now = midOf("burn");
    function liveRun(daysAgo: number, km: number, paceSecPerKm: number, hr: number) {
      const startDate = addDays(now, -daysAgo);
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
        totalElevationGain: 15,
      } as HomeActivityLike;
    }
    const runs: HomeActivityLike[] = [
      liveRun(6, 10, 270, 168),
      liveRun(9, 12, 330, 148),
      liveRun(13, 9, 335, 145),
      liveRun(17, 10, 330, 146),
      liveRun(24, 8, 340, 142),
      liveRun(31, 15, 335, 150),
    ];
    const view = buildPlanView(runs, now, RACE, RACE_NAME, true);
    expect(view.dataDriven).toBe(true);
    expect(view.upcomingWeeks).toHaveLength(3);
    for (const week of view.upcomingWeeks) {
      expect(week.km).toBeGreaterThan(0);
      expect(week.sessions.length).toBeGreaterThan(0);
    }
    expect(new Set(view.upcomingWeeks.map((w) => w.dateRange)).size).toBe(3);
  });
});

describe("race distance — what the plan is actually for", () => {
  // The page used to name the race but never its distance, so "13 uger, ét mål
  // under 1:55" never said 1:55 for *what*; the only place it appeared was
  // inside the edit dialog.
  const NOW = midOf("burn");

  it("names the half marathon the predictor assumes when no distance is stored", () => {
    const view = buildPlanView(undefined, NOW, RACE, RACE_NAME);
    expect(view.race.distanceLabel).toBe("Halvmaraton");
    expect(view.race.distanceInline).toBe("halvmaraton");
    expect(view.race.distanceKmLabel).toBe("21,1 km");
  });

  it("names the runner's own distance when they picked one", () => {
    const view = buildPlanView(undefined, NOW, RACE, RACE_NAME, false, null, 10);
    expect(view.race.distanceLabel).toBe("10K");
    // A label carrying a number keeps its casing mid-sentence.
    expect(view.race.distanceInline).toBe("10K");
    expect(view.race.distanceKmLabel).toBe("10 km");
  });

  it("reads a rounded half-marathon distance as the half", () => {
    const view = buildPlanView(undefined, NOW, RACE, RACE_NAME, false, null, 21.1);
    expect(view.race.distanceLabel).toBe("Halvmaraton");
  });

  it("falls back to the distance itself for anything off the standard ladder", () => {
    const view = buildPlanView(undefined, NOW, RACE, RACE_NAME, false, null, 12.5);
    expect(view.race.distanceLabel).toBe("12,5 km");
    expect(view.race.distanceInline).toBe("12,5 km");
  });
});

describe("upcoming weeks — concrete enough to plan a week around (issue #247)", () => {
  it("names each run with its distance and pace target", () => {
    // The peak block carries all three kinds: a long run, a tempo and easy days.
    const view = buildPlanView(undefined, midOf("peak"), RACE, RACE_NAME);
    const week = view.upcomingWeeks[0];

    const ids = week.sessions.map((session) => session.id);
    expect(ids).toContain("long");
    expect(ids).toContain("tempo");
    expect(ids).toContain("easy");

    const long = week.sessions.find((session) => session.id === "long");
    expect(long?.label).toBe("Langtur");
    expect(long?.distance).toMatch(/^\d+(,\d)? km$/);
    expect(long?.pace).toMatch(/^\d+:\d{2} \/km$/);

    // The easy rows are grouped into one line that counts them.
    const easy = week.sessions.find((session) => session.id === "easy");
    expect(easy?.label).toMatch(/rolige? tur/);
  });

  it("measures the first week against the week the runner is in", () => {
    const view = buildPlanView(undefined, midOf("burn"), RACE, RACE_NAME);
    expect(view.upcomingWeeks[0].deltaKm).toBe(view.upcomingWeeks[0].km - view.weekKm);
  });

  it("dates every week and places it inside its block", () => {
    const view = buildPlanView(undefined, midOf("sharpen"), RACE, RACE_NAME);
    for (const week of view.upcomingWeeks) {
      expect(week.dateRange).toMatch(/^\d+\..*\d+\. \w+$/);
      expect(week.phaseProgress).toMatch(/^uge \d+ af \d+$/);
      const [, at, of] = week.phaseProgress.match(/^uge (\d+) af (\d+)$/) ?? [];
      expect(Number(at)).toBeLessThanOrEqual(Number(of));
      expect(week.runCount).toBeGreaterThan(0);
    }
  });

  it("puts the runner's own race distance on race day, not a hardcoded half", () => {
    const view = buildPlanView(undefined, addDays(RACE, -15), RACE, RACE_NAME, false, null, 10);
    const raceWeek = view.upcomingWeeks.find((week) => week.isRaceWeek);
    const race = raceWeek?.sessions.find((session) => session.id === "race");
    expect(race?.distance).toBe("10 km");
  });

  it("flags the race week and shows the race distance in it", () => {
    // Two weeks out, race day falls inside the upcoming window.
    const view = buildPlanView(undefined, addDays(RACE, -15), RACE, RACE_NAME);
    const raceWeek = view.upcomingWeeks.find((week) => week.isRaceWeek);
    expect(raceWeek).toBeDefined();
    const race = raceWeek?.sessions.find((session) => session.id === "race");
    expect(race?.label).toBe("Race");
    expect(race?.distance).toMatch(/km$/);
    expect(view.upcomingWeeks.filter((week) => week.isRaceWeek)).toHaveLength(1);
  });
});
