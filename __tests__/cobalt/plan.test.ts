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
import {
  formatPaceClock,
  formatPaceRange,
  predictRace,
  zonePaces,
} from "@/lib/training/prediction";

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

  const PREDICTION = predictRace(RUNS, LIVE_NOW).prediction;
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
    // `now` is Thursday, so Wednesday's tempo is behind us with no run logged: it
    // reads as missed, and the quality session is rescued onto a later run day
    // rather than silently dropped (issue #211).
    expect(view.days[2].kind).toBe("missed");
    expect(view.days.some((day) => day.name === "Tempo")).toBe(true);
    expect(view.days[6].name).toBe("Lang tur");
  });

  it("derives every pace target from the race predictor — no template text survives", () => {
    const view = live();
    // Thursday's `now`: the rescued tempo and Sunday's long run are both
    // prescriptions, not results.
    const tempo = view.days.find((day) => day.name === "Tempo");
    expect(tempo?.meta).toBe(`MÅL ${formatPaceRange(PACES.tempo)}`);
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
    expect(view.days[0].name).toBe("Rolig jog");
    expect(view.weekPlannedKm).toBe(53);
    expect(view.race.aiEstimate).toBe("3:41");
    // A visitor's demo card is designed, not derived — nothing to unlock.
    expect(view.race.lock).toBeNull();
  });

  it("measures the runner's effort against the max HR it's handed (issue #116)", () => {
    // The anchor is a 10 km at 168 bpm. Left to itself the predictor takes that
    // for a max effort (it's the hardest HR it can see); told the runner's real
    // ceiling is 200, the same run was 84% effort and the estimate turns cautious.
    const observed = buildPlanView(RUNS, LIVE_NOW, RACE, RACE_NAME, true);
    const withHrMax = buildPlanView(RUNS, LIVE_NOW, RACE, RACE_NAME, true, 200);

    const seconds = (time: string) => {
      const [h, m] = time.split(":").map(Number);
      return h * 3600 + m * 60;
    };
    expect(seconds(withHrMax.race.aiEstimate)).toBeGreaterThan(seconds(observed.race.aiEstimate));
    // Cautious end to end: the pace targets move with the prediction. Sunday's
    // long run is prescribed in both views, so its target is a stable probe.
    expect(withHrMax.days[6].meta).not.toBe(observed.days[6].meta);
  });
});

describe("buildPlanView — locked race card (issue #117)", () => {
  // Inside the race's own build, so the phase engine has a week to prescribe.
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
    // The card can name the run that would unlock the estimate — a quarter of the
    // half marathon it's counting down to, not a bare 5 km.
    expect(view.race.lock?.requiredKm).toBe(5.5);
    expect(view.race.lock?.message).toContain("5,5 km");
    // The template's sessions still stand in — only the race numbers are withheld.
    expect(view.days[0].name).toBe("Rolig jog");
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

  /** The width (seconds) of a "MÅL m:ss–m:ss" range meta, or null if it isn't one. */
  function rangeWidth(meta: string | undefined): number | null {
    const m = meta?.match(/(\d+):(\d\d)–(\d+):(\d\d)/);
    if (!m) return null;
    return Number(m[3]) * 60 + Number(m[4]) - (Number(m[1]) * 60 + Number(m[2]));
  }

  it("widens the pace range when the prediction rests on a single run", () => {
    // One qualifying run → low confidence. The plan must show a broader interval
    // rather than fake the precision of a tight target.
    const prediction = predictRace([liveRun(3, 8, 330, 140)], NOW).prediction;
    expect(prediction?.confidence).toBe("low");

    const view = buildPlanView([liveRun(3, 8, 330, 140)], NOW, RACE, RACE_NAME, true);
    const widths = view.days
      .map((day) => rangeWidth(day.meta))
      .filter((w): w is number => w !== null);
    expect(widths.length).toBeGreaterThan(0);
    // Every prescribed range is wider than the default ±10 s (20 s total).
    for (const width of widths) {
      expect(width).toBeGreaterThan(20);
    }
  });

  it("keeps a tight range when the prediction is well-founded", () => {
    // Six qualifying runs with a close basis → high confidence → the default range.
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
    const widths = view.days
      .map((day) => rangeWidth(day.meta))
      .filter((w): w is number => w !== null);
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) {
      expect(width).toBe(20);
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
    // `now` must sit inside the DEFAULT race's build, not the 2027 one's.
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

  // A hard 10 km to anchor the prediction, plus a steady base of longer runs.
  const RUNS: HomeActivityLike[] = [
    liveRun(6, 10, 270, 168),
    liveRun(9, 12, 330, 148),
    liveRun(13, 9, 335, 145),
    liveRun(17, 10, 330, 146),
    liveRun(24, 8, 340, 142),
    liveRun(31, 15, 335, 150),
  ];

  /** A finish time "h:mm[:ss]" or "m:ss" as total seconds. */
  const seconds = (time: string) => {
    const parts = time.split(":").map(Number);
    return parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 3600 + parts[1] * 60;
  };

  it("targets the chosen distance, not the half-marathon default", () => {
    const tenK = buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, null, 10);
    const half = buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, null, 21.0975);
    // The same runs predict a much faster finish over 10 km than over a half.
    expect(seconds(tenK.race.aiEstimate)).toBeLessThan(seconds(half.race.aiEstimate));
    expect(tenK.race.distanceKm).toBe(10);
  });

  it("shows the runner's own goal as the headline and race pace, keeping the estimate", () => {
    // A 40:00 goal over 10 km → 4:00 /km, faster than the ~45:00 the model predicts.
    const view = buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, null, 10, 2400);
    expect(view.race.goalTime).toBe("40:00");
    expect(view.race.racePace).toBe(formatPaceClock(240));
    expect(view.goalLabel).toBe("Mål under 40:00");
    expect(view.race.goalTimeSeconds).toBe(2400);
    expect(view.race.distanceKm).toBe(10);
    // The AI estimate is still the model's prediction, distinct from the goal.
    expect(view.race.aiEstimate).not.toBe(view.race.goalTime);
  });

  it("anchors the week's pace grid on goal pace when a goal is set", () => {
    // Runs that carry easy heart-rate data, so the predictor observes an easy pace
    // and the goal legitimately anchors the whole grid, floored against it (#231).
    // (When no run carries HR the easy side stays on the prediction instead — see
    // the issue #242 block below.)
    const hrRuns: HomeActivityLike[] = [
      liveRun(6, 10, 265, 175), // hard anchor at race effort
      liveRun(9, 12, 338, 135), // easy base runs
      liveRun(13, 9, 340, 132),
      liveRun(17, 10, 336, 134),
      liveRun(24, 8, 342, 130),
      liveRun(31, 15, 337, 138),
    ];
    const withGoal = buildPlanView(hrRuns, NOW, RACE, RACE_NAME, true, null, 10, 2400);
    const withoutGoal = buildPlanView(hrRuns, NOW, RACE, RACE_NAME, true, null, 10);
    // Ambitious goal pace pulls the prescribed targets faster than the pure
    // prediction would — the two weeks can't read identically.
    const metas = (view: ReturnType<typeof buildPlanView>) =>
      view.days.map((day) => day.meta ?? "").join(" ");
    expect(metas(withGoal)).not.toBe(metas(withoutGoal));
  });

  it("keeps the prediction-derived goal when no goal is set (old behavior)", () => {
    const view = buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, null, 10);
    expect(view.race.goalTimeSeconds).toBeNull();
    // Headline is the prediction's committable goal, not a user target.
    expect(view.goalLabel).toBe(`Mål under ${view.race.goalTime}`);
  });

  it("keeps the demo numbers for a visitor with no race at all", () => {
    // No distance, no goal, live off — the designed demo card stands.
    const view = buildPlanView(undefined, NOW, RACE, RACE_NAME);
    expect(view.race.goalTime).toBe("3:45");
    expect(view.race.racePace).toBe("5:20");
    expect(view.race.aiEstimate).toBe("3:41");
    expect(view.race.distanceKm).toBeNull();
    expect(view.race.goalTimeSeconds).toBeNull();
  });
});

describe("buildPlanView — goal pace stays grounded without easy data (issue #242)", () => {
  // The common live case: Strava runs that carry no heart rate, so the predictor
  // has no observed easy pace to floor the grid against (#231's floor is null). On
  // a peak-phase Monday the whole week is still ahead — the Wednesday tempo, the
  // Sunday long and the easy days are all prescribed, none logged yet — so every
  // zone target is probed.
  const PEAK_MID = midOf("peak");
  const NOW = addDays(PEAK_MID, -((PEAK_MID.getDay() + 6) % 7));

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

  // A hard 10 km anchors the prediction (~45:00), plus a steady base — all logged
  // more than a week ago, so none land in this week as already-completed runs.
  const RUNS: HomeActivityLike[] = [
    noHrRun(8, 10, 270),
    noHrRun(11, 12, 330),
    noHrRun(15, 9, 335),
    noHrRun(19, 10, 330),
    noHrRun(26, 8, 340),
    noHrRun(33, 15, 335),
  ];

  // 40:00 over 10 km → 4:00 /km, more aspirational than the ~45:00 the model predicts.
  const GOAL_10K = 2400;

  const PREDICTION = predictRace(RUNS, NOW, 10).prediction;
  if (!PREDICTION) throw new Error("fixture must support a prediction");
  const GROUNDED = zonePaces(PREDICTION);
  const GOAL_GRID = zonePaces({ ...PREDICTION, paceSecPerKm: Math.round(GOAL_10K / 10) });

  const withGoal = buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, null, 10, GOAL_10K);
  const withoutGoal = buildPlanView(RUNS, NOW, RACE, RACE_NAME, true, null, 10);

  it("has no observed easy pace to floor against — and the goal is genuinely faster", () => {
    // The #242 trigger: no run carries heart rate, so the #231 floor is unavailable.
    expect(PREDICTION.observedEasyPaceSecPerKm).toBeNull();
    // …and the goal really is more aspirational than the prediction (the case that bites).
    expect(GOAL_GRID.easy).toBeLessThan(GROUNDED.easy);
  });

  it("keeps the easy side on the prediction instead of the aspirational goal", () => {
    // Every prescribed easy/recovery/long day trains at the grounded prediction
    // pace — identical to the no-goal plan, never dragged up to goal pace.
    const easyNames = new Set(["Rolig tur", "Rolig jog", "Rolig + strides", "Lang tur"]);
    let checked = 0;
    withGoal.days.forEach((day, index) => {
      if ((day.kind === "today" || day.kind === "planned") && easyNames.has(day.name)) {
        expect(day.meta).toBe(withoutGoal.days[index].meta);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(0);
    // Concretely: the long run sits on the grounded pace, not the faster goal pace.
    const long = withGoal.days.find((day) => day.name === "Lang tur");
    expect(long?.meta).toBe(`MÅL ${formatPaceRange(GROUNDED.long)}`);
    expect(long?.meta).not.toBe(`MÅL ${formatPaceRange(GOAL_GRID.long)}`);
  });

  it("still trains the quality session and race target toward the goal", () => {
    // The tempo target follows the goal — that's the point of setting one — so it
    // moves relative to the pure prediction while the easy side does not.
    const tempo = withGoal.days.find((day) => day.name === "Tempo");
    expect(tempo?.meta).toBe(`MÅL ${formatPaceRange(GOAL_GRID.tempo)}`);
    expect(tempo?.meta).not.toBe(`MÅL ${formatPaceRange(GROUNDED.tempo)}`);
    // The race card keeps goal pace too — the race-card path is untouched (#238).
    expect(withGoal.race.racePace).toBe(formatPaceClock(Math.round(GOAL_10K / 10)));
  });

  it("leaves the grid on the pure prediction when no goal is set", () => {
    const long = withoutGoal.days.find((day) => day.name === "Lang tur");
    const tempo = withoutGoal.days.find((day) => day.name === "Tempo");
    expect(long?.meta).toBe(`MÅL ${formatPaceRange(GROUNDED.long)}`);
    expect(tempo?.meta).toBe(`MÅL ${formatPaceRange(GROUNDED.tempo)}`);
    expect(withoutGoal.race.goalTimeSeconds).toBeNull();
  });

  it("still floors the grid on observed easy pace when heart rate is present (#231 intact)", () => {
    // Same shape, but now the runs carry HR and most were run easy — so the
    // predictor DOES observe an easy pace and the #231/#238 path is unchanged: the
    // goal anchors the grid, floored against the runner's real easy pace.
    const hrRuns: HomeActivityLike[] = [
      { ...noHrRun(8, 10, 265), averageHeartrate: 175 }, // hard anchor at race effort
      { ...noHrRun(11, 12, 340), averageHeartrate: 135 }, // easy base runs
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
    const tempo = view.days.find((day) => day.name === "Tempo");
    const long = view.days.find((day) => day.name === "Lang tur");
    expect(tempo?.meta).toBe(`MÅL ${formatPaceRange(expected.tempo)}`);
    expect(long?.meta).toBe(`MÅL ${formatPaceRange(expected.long)}`);
  });
});

describe("buildPlanView — dynamic week (issue #211)", () => {
  // Adapt is the simplest block for the neighbour rules: four easy run days,
  // Monday/Wednesday/Friday/Sunday, no tempo or long run to muddy the picture.
  const ADAPT_MONDAY = (() => {
    const mid = midOf("adapt");
    return addDays(mid, -((mid.getDay() + 6) % 7));
  })();

  function run(
    daysFromMonday: number,
    km: number,
    paceSecPerKm: number,
    hr: number
  ): HomeActivityLike {
    const startDate = addDays(ADAPT_MONDAY, daysFromMonday);
    startDate.setHours(7, 30, 0, 0);
    const distance = km * 1000;
    const movingTime = Math.round(km * paceSecPerKm);
    return {
      id: `run-${daysFromMonday}-${km}`,
      name: `Tur ${daysFromMonday}`,
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

  // Prior-week runs that anchor a prediction — a hard 10 km plus a steady base.
  // None fall inside the current training week, so this week starts empty.
  const HISTORY: HomeActivityLike[] = [
    run(-6, 10, 270, 168),
    run(-8, 16, 330, 150),
    run(-10, 8, 345, 138),
    run(-13, 9, 340, 142),
    run(-15, 14, 335, 148),
    run(-20, 10, 335, 144),
    run(-27, 8, 345, 138),
    run(-31, 15, 335, 150),
    run(-40, 10, 340, 142),
  ];

  const WEDNESDAY = addDays(ADAPT_MONDAY, 2);

  it("(a) shows a past run day with no activity as missed, not pending", () => {
    const view = buildPlanView(HISTORY, WEDNESDAY, RACE, RACE_NAME, true);
    expect(view.dataDriven).toBe(true);
    // Monday was a prescribed easy run; nothing was logged and it's behind us.
    expect(view.days[0].kind).toBe("missed");
    expect(view.days[0].name).toBe("Ikke gennemført");
    expect(view.days[0].meta).toBeUndefined();
    expect(view.days[0].distance).toBeUndefined();
  });

  it("(a) drops missed volume from weekPlannedKm and adjusts the remaining days", () => {
    const missedView = buildPlanView(HISTORY, WEDNESDAY, RACE, RACE_NAME, true);
    // The same week with Monday actually run — nothing missed.
    const doneView = buildPlanView(
      [...HISTORY, run(0, 7, 340, 138)],
      WEDNESDAY,
      RACE,
      RACE_NAME,
      true
    );
    expect(missedView.days[0].kind).toBe("missed");
    expect(doneView.days[0].kind).toBe("done");
    // The adjusted plan asks less of the week than the untouched skeleton would.
    expect(missedView.weekPlannedKm).toBeLessThan(doneView.weekPlannedKm);
  });

  it("(b) treats an unplanned hard run yesterday as a hard day — lighter today", () => {
    // Viewing the plan Wednesday morning, a full day past Tuesday's run: the
    // 24 h easy buffer is met (issue #240 rests only a *too-recent* run), so the
    // day stays a prescription — softened to a recovery jog by Tuesday's effort.
    const wednesdayMorning = addDays(ADAPT_MONDAY, 2);
    wednesdayMorning.setHours(9, 0, 0, 0);
    const withoutHard = buildPlanView(HISTORY, wednesdayMorning, RACE, RACE_NAME, true);
    // A fast, unplanned run on Tuesday (a planned rest day), 25.5 h before now.
    const hardTuesday = run(1, 10, 230, 178);
    const withHard = buildPlanView(
      [...HISTORY, hardTuesday],
      wednesdayMorning,
      RACE,
      RACE_NAME,
      true
    );

    // Wednesday is an ordinary easy day when nothing hard preceded it…
    expect(withoutHard.days[2].name).toBe("Rolig tur");
    // …but a recovery jog once Tuesday's hard effort is on the books.
    expect(withHard.days[1].kind).toBe("done");
    expect(withHard.days[2].name).toBe("Rolig jog");
  });

  it("(c) merges two runs logged on the same day into one completed card", () => {
    const view = buildPlanView(
      [...HISTORY, run(0, 5, 340, 135), run(0, 4, 320, 150)],
      WEDNESDAY,
      RACE,
      RACE_NAME,
      true
    );
    expect(view.days[0].kind).toBe("done");
    expect(view.days[0].name).toBe("2 ture");
    expect(view.days[0].distance).toBe("9,0 km");
  });

  it("rescues a missed tempo onto a remaining run day instead of dropping it", () => {
    // Peak has a Wednesday tempo; on Thursday it's behind us with no run logged.
    const peakMid = midOf("peak");
    const peakMonday = addDays(peakMid, -((peakMid.getDay() + 6) % 7));
    const thursday = addDays(peakMonday, 3);
    const peakHistory: HomeActivityLike[] = HISTORY.map((activity, i) => {
      const startDate = addDays(peakMonday, -6 - i * 3);
      startDate.setHours(7, 30, 0, 0);
      return { ...activity, id: `peak-${i}`, startDate };
    });

    const view = buildPlanView(peakHistory, thursday, RACE, RACE_NAME, true);
    expect(view.dataDriven).toBe(true);
    expect(view.days[2].kind).toBe("missed"); // Wednesday's tempo, unrun
    expect(view.days.some((day) => day.name === "Tempo")).toBe(true); // rescued
  });
});

describe("buildPlanView — recovery buffer (issue #240)", () => {
  // The plan page must apply the same recovery buffer as the coach card
  // (lib/coach/recommender.ts): a hard session needs 48 h since the last actual
  // run, an easy/long one 24 h. Otherwise the coach says REST while the plan
  // still prescribes a run today — the two surfaces contradicting each other.
  // Adapt is the simplest block for it: easy run days Mon/Wed/Fri/Sun, no
  // tempo/long to muddy the read (mirrors the #211 block above).
  const ADAPT_MONDAY = (() => {
    const mid = midOf("adapt");
    return addDays(mid, -((mid.getDay() + 6) % 7));
  })();

  /** A run `daysFromMonday` into the adapt week, at `hour`:`minute`. */
  function run(
    daysFromMonday: number,
    km: number,
    paceSecPerKm: number,
    hr: number,
    hour = 7,
    minute = 30
  ): HomeActivityLike {
    const startDate = addDays(ADAPT_MONDAY, daysFromMonday);
    startDate.setHours(hour, minute, 0, 0);
    const distance = km * 1000;
    const movingTime = Math.round(km * paceSecPerKm);
    return {
      id: `run-${daysFromMonday}-${km}-${hour}${minute}`,
      name: `Tur ${daysFromMonday}`,
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

  // Prior-week runs that anchor a prediction — a hard 10 km plus a steady base,
  // none inside the current training week.
  const HISTORY: HomeActivityLike[] = [
    run(-6, 10, 270, 168),
    run(-8, 16, 330, 150),
    run(-10, 8, 345, 138),
    run(-13, 9, 340, 142),
    run(-15, 14, 335, 148),
    run(-20, 10, 335, 144),
  ];

  it("rests today when the most recent run is inside the recovery window (< 24 h)", () => {
    // A hard 10 km Tuesday evening (20:30); the runner opens the plan Wednesday
    // 08:00 — ~11.5 h later, well inside the 24 h easy buffer.
    const tuesdayEvening = run(1, 10, 250, 176, 20, 30);
    const wednesdayMorning = addDays(ADAPT_MONDAY, 2);
    wednesdayMorning.setHours(8, 0, 0, 0);

    const view = buildPlanView(
      [...HISTORY, tuesdayEvening],
      wednesdayMorning,
      RACE,
      RACE_NAME,
      true
    );
    expect(view.dataDriven).toBe(true);
    const today = view.days[2]; // Wednesday
    expect(today.dow).toContain("I DAG");
    expect(today.kind).toBe("rest"); // a rest tile, not a prescribed run
    expect(today.name).toBe("Hviledag");
    expect(today.distance).toBeUndefined();
    expect(today.meta).toBeUndefined();
  });

  it("prescribes a normal week when the last run is ≥ 48 h ago", () => {
    // No runs this week; the most recent is 8 days back — no buffer to respect.
    const wednesday = addDays(ADAPT_MONDAY, 2);
    wednesday.setHours(9, 0, 0, 0);

    const view = buildPlanView(HISTORY, wednesday, RACE, RACE_NAME, true);
    expect(view.dataDriven).toBe(true);
    const today = view.days[2]; // Wednesday
    expect(today.kind).toBe("today"); // a prescribed run, not a rest
    expect(today.name).toBe("Rolig tur");
    expect(today.distance).toBeDefined();
  });

  it("applies the 24 h easy buffer exactly — 23 h rests, 24 h runs", () => {
    const wednesday = addDays(ADAPT_MONDAY, 2);
    wednesday.setHours(8, 0, 0, 0);

    // Tuesday 08:00 → exactly 24 h before now: not < 24, so the day is prescribed.
    const exactly24h = buildPlanView(
      [...HISTORY, run(1, 8, 340, 140, 8, 0)],
      wednesday,
      RACE,
      RACE_NAME,
      true
    );
    expect(exactly24h.days[2].kind).toBe("today");
    expect(exactly24h.days[2].name).toBe("Rolig tur");

    // Tuesday 09:00 → 23 h before now: inside the buffer, so the day rests.
    const at23h = buildPlanView(
      [...HISTORY, run(1, 8, 340, 140, 9, 0)],
      wednesday,
      RACE,
      RACE_NAME,
      true
    );
    expect(at23h.days[2].kind).toBe("rest");
    expect(at23h.days[2].name).toBe("Hviledag");
  });

  it("holds a hard session to the 48 h buffer even once the 24 h easy one is met", () => {
    // Peak Wednesday is a tempo day. A run 25.5 h ago clears the easy buffer but
    // not the hard one, so the tempo is withheld — the coach's exact distinction.
    const peakMid = midOf("peak");
    const peakMonday = addDays(peakMid, -((peakMid.getDay() + 6) % 7));
    const wednesday = addDays(peakMonday, 2);
    wednesday.setHours(9, 0, 0, 0);

    // Peak Wednesday really is the tempo day for this race.
    expect(getWeekPlan(getCurrentPhase(wednesday, RACE), peakMonday, RACE, RACE_NAME)[2].type).toBe(
      "tempo"
    );

    const peakHistory: HomeActivityLike[] = HISTORY.map((activity, i) => {
      const startDate = addDays(peakMonday, -6 - i * 3);
      startDate.setHours(7, 30, 0, 0);
      return { ...activity, id: `peak-${i}`, startDate };
    });
    // Tuesday 07:30 → 25.5 h before Wednesday 09:00.
    const tuesdayStart = addDays(peakMonday, 1);
    tuesdayStart.setHours(7, 30, 0, 0);
    const tuesday: HomeActivityLike = { ...HISTORY[0], id: "peak-tue", startDate: tuesdayStart };

    const view = buildPlanView([...peakHistory, tuesday], wednesday, RACE, RACE_NAME, true);
    expect(view.dataDriven).toBe(true);
    expect(view.days[1].kind).toBe("done"); // Tuesday's logged run
    expect(view.days[2].kind).toBe("rest"); // Wednesday's tempo, held back
    expect(view.days[2].name).toBe("Hviledag");
  });
});

describe("buildPlanView — Kommende uger, phase-aware (issue #237)", () => {
  // The label each phase carries in the upcoming-week focus copy — "Nedtrapning"
  // for the taper, the phase name otherwise (mirrors plan.ts's PHASE_LABELS).
  const UI_PHASE: Record<PhaseKey, string> = {
    adapt: "Adapt",
    burn: "Burn",
    sharpen: "Sharpen",
    peak: "Peak",
    taper: "Nedtrapning",
  };

  /** The Monday of the training week `now` falls in — mirrors the view-model. */
  function trainingWeekMonday(now: Date): Date {
    return addDays(now, -((now.getDay() + 6) % 7));
  }

  it("derives the template path's rows from the phase engine, not a frozen 52/56/38", () => {
    // Visitor/demo traffic: live off, so buildPlanView takes the template branch.
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
      // Each row is the next plan week, at that week's real forecasted volume.
      expect(week.week).toBe(view.weekOfPlan + i + 1);
      expect(week.km).toBe(km);
      // The phase shows through in the copy, and only a taper reads muted.
      expect(week.focus).toContain(UI_PHASE[phase]);
      expect(week.muted).toBe(phase === "taper");
    });

    // None of the old frozen copy survives.
    const allFocus = view.upcomingWeeks.map((w) => w.focus).join(" ");
    expect(allFocus).not.toContain("8×1000 m");
    expect(allFocus).not.toContain("marathon-pace");
  });

  it("differentiates consecutive weeks that fall in the same phase", () => {
    // Early in burn (a 4-week block) so all three upcoming weeks stay in burn —
    // the case that used to render three identical rows.
    const now = addDays(RACE, -75);
    const monday = trainingWeekMonday(now);
    const phases = [1, 2, 3].map((o) => getCurrentPhase(addDays(monday, o * 7), RACE));
    expect(new Set(phases).size).toBe(1); // one phase across the whole window
    expect(phases[0]).toBe("burn");

    const view = buildPlanView(undefined, now, RACE, RACE_NAME);
    const focuses = view.upcomingWeeks.map((w) => w.focus);
    // No two rows read identically, even within a single phase.
    expect(new Set(focuses).size).toBe(focuses.length);
  });

  it("lets a phase change show through across the window", () => {
    // A window straddling the burn→sharpen boundary (offset+1 burn, offset+3
    // sharpen for any Monday this near the boundary).
    const now = addDays(RACE, -62);
    const monday = trainingWeekMonday(now);
    const phases = [1, 2, 3].map((o) => getCurrentPhase(addDays(monday, o * 7), RACE));
    expect(new Set(phases).size).toBeGreaterThan(1); // the window spans phases

    const view = buildPlanView(undefined, now, RACE, RACE_NAME);
    // Where the phase differs, the copy differs; and all three rows stay distinct.
    for (let i = 1; i < 3; i++) {
      if (phases[i] !== phases[i - 1]) {
        expect(view.upcomingWeeks[i].focus).not.toBe(view.upcomingWeeks[i - 1].focus);
      }
    }
    expect(new Set(view.upcomingWeeks.map((w) => w.focus)).size).toBe(3);
  });

  it("reads any taper week muted with the nedtrapning copy", () => {
    // A Saturday race, so the race week's Monday lands in the taper (a Sunday
    // race's would read peak). Scan the run-in so the taper branch is exercised.
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
          expect(week.focus).toContain("Nedtrapning");
        }
      });
    }
    expect(sawTaper).toBe(true);
  });

  it("keeps the derived (live) path's rows phase-aware and distinct", () => {
    // A runner with a real prediction, sitting mid-burn so the outlook builds.
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
    }
    // The derived rows are as distinct as the template's — no static repeat.
    expect(new Set(view.upcomingWeeks.map((w) => w.focus)).size).toBe(3);
  });
});
