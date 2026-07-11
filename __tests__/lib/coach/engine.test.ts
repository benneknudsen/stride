import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_CONSTRAINTS,
  buildPhases,
  DEFAULT_RACE_DATE,
  EASY_MIN_RECOVERY_HOURS,
  getActiveConstraints,
  getCurrentPhase,
  getPhaseRules,
  getWeekPlan,
  MAX_WEEKLY_INCREASE_RATIO,
  MIN_RECOVERY_HOURS,
  type PhaseKey,
  planTotalWeeks,
  type SessionType,
  serializeValidationResult,
  validateWorkout,
  WEEKDAYS,
  type WorkoutContext,
  ZONE2_CEILING_BPM,
} from "@/lib/coach/engine";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// The engine is parameterised on the race date (issue #99), so no fixture below
// hardcodes a phase date — everything derives from this pinned race via the
// engine's own buildPhases. The pin equals DEFAULT_RACE_DATE so the default
// paths are exercised too.
const TEST_RACE_DATE = new Date(2026, 8, 20);

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

/** The same calendar day at a given time of day. */
function at(date: Date, hours: number, minutes = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
}

const PHASES_T = buildPhases(TEST_RACE_DATE);

/** A date roughly in the middle of a phase's window. */
function midOf(phase: PhaseKey): Date {
  const rules = PHASES_T[phase];
  return addDays(rules.startDate, Math.floor(daysBetween(rules.startDate, rules.endDate) / 2));
}

/** First date with the given JS weekday (0 = Sun) inside a phase's window. */
function weekdayIn(phase: PhaseKey, jsWeekday: number): Date {
  let d = PHASES_T[phase].startDate;
  while (d.getDay() !== jsWeekday) d = addDays(d, 1);
  return d;
}

// A burn-phase Wednesday morning — the standard anchor for validation contexts.
const BURN_WEDNESDAY = at(weekdayIn("burn", 3), 8);

/** `hours` before the burn Wednesday anchor. */
function hoursBefore(hours: number): Date {
  return new Date(BURN_WEDNESDAY.getTime() - hours * HOUR_MS);
}

/** A clean, fully-recovered burn-phase context; override only what a test needs. */
function ctx(overrides: Partial<WorkoutContext> = {}): WorkoutContext {
  return {
    plannedDate: BURN_WEDNESDAY,
    phase: "burn",
    ...overrides,
  };
}

const ALL_PHASES: PhaseKey[] = ["adapt", "burn", "sharpen", "peak"];
const FULL_SEQUENCE: PhaseKey[] = ["adapt", "burn", "sharpen", "peak", "taper"];

afterEach(() => {
  vi.useRealTimers();
});

describe("buildPhases — dated blocks from the relative template", () => {
  // Multiple race dates, including one shortly after leap day 2028 and one
  // whose build crosses the October DST fall-back — offsets are whole calendar
  // days, so neither may displace a boundary.
  const RACE_DATES: [string, Date][] = [
    ["the pinned 2026 race", TEST_RACE_DATE],
    ["a spring 2027 race", new Date(2027, 4, 30)],
    ["a race just after leap day 2028", new Date(2028, 2, 5)],
    ["a race whose build crosses the October DST shift", new Date(2026, 10, 15)],
  ];

  it.each(RACE_DATES)("%s: contiguous phases spanning exactly 90 days", (_label, race) => {
    const phases = buildPhases(race);
    for (let i = 1; i < FULL_SEQUENCE.length; i++) {
      const prev = phases[FULL_SEQUENCE[i - 1]];
      const next = phases[FULL_SEQUENCE[i]];
      expect(daysBetween(prev.endDate, next.startDate), `${FULL_SEQUENCE[i]} start`).toBe(1);
    }
    expect(daysBetween(phases.adapt.startDate, race)).toBe(90);
    expect(daysBetween(phases.taper.endDate, race)).toBe(0); // taper ends on race day
  });

  it("keeps the default race on the original dated 2026 blocks", () => {
    // The template's offsets were derived 1:1 from the original PHASES table —
    // this is the one place the historical dates are allowed to appear.
    const phases = buildPhases(DEFAULT_RACE_DATE);
    expect(phases.adapt.startDate).toEqual(new Date(2026, 5, 22));
    expect(phases.adapt.endDate).toEqual(new Date(2026, 6, 5));
    expect(phases.burn.startDate).toEqual(new Date(2026, 6, 6));
    expect(phases.burn.endDate).toEqual(new Date(2026, 7, 2));
    expect(phases.sharpen.startDate).toEqual(new Date(2026, 7, 3));
    expect(phases.sharpen.endDate).toEqual(new Date(2026, 7, 23));
    expect(phases.peak.startDate).toEqual(new Date(2026, 7, 24));
    expect(phases.peak.endDate).toEqual(new Date(2026, 8, 14));
    expect(phases.taper.startDate).toEqual(new Date(2026, 8, 15));
    expect(phases.taper.endDate).toEqual(new Date(2026, 8, 20));
  });

  it("carries the date-independent rules unchanged onto every race", () => {
    const phases = buildPhases(new Date(2027, 9, 10));
    for (const key of FULL_SEQUENCE) {
      const { startDate: _s, endDate: _e, ...rules } = phases[key];
      const { startDate: _s2, endDate: _e2, ...defaults } = PHASES_T[key];
      expect(rules).toEqual(defaults);
    }
  });

  it("ignores time-of-day on the race date", () => {
    expect(buildPhases(new Date(2027, 9, 10, 18, 30))).toEqual(buildPhases(new Date(2027, 9, 10)));
  });

  it("re-anchors getCurrentPhase to an arbitrary race date", () => {
    const race = new Date(2027, 9, 10);
    const phases = buildPhases(race);
    const mid = addDays(phases.burn.startDate, 10);
    expect(getCurrentPhase(mid, race)).toBe("burn");
    expect(getCurrentPhase(addDays(race, -1), race)).toBe("taper"); // race tomorrow
    expect(getCurrentPhase(race, race)).toBe("taper"); // race day
    expect(getCurrentPhase(addDays(race, 30), race)).toBe("peak"); // race passed: hold
  });

  it("steps into the plan mid-build when the race is under 90 days away", () => {
    // Offsets stay fixed (no compression): a close race simply puts today in a
    // later block. 40 days out lands inside sharpen (48–28 days before race).
    const today = TEST_RACE_DATE;
    const race = addDays(today, 40);
    expect(getCurrentPhase(today, race)).toBe("sharpen");
  });
});

describe("planTotalWeeks", () => {
  it("derives 13 weeks for any race date (fixed offsets)", () => {
    expect(planTotalWeeks(TEST_RACE_DATE)).toBe(13);
    expect(planTotalWeeks(new Date(2027, 9, 10))).toBe(13);
    expect(planTotalWeeks()).toBe(13); // default race
  });
});

describe("getCurrentPhase — phase windows", () => {
  it("maps a mid-block date to each phase", () => {
    for (const phase of ALL_PHASES) {
      expect(getCurrentPhase(midOf(phase), TEST_RACE_DATE)).toBe(phase);
    }
  });

  it("treats phase start dates as inclusive", () => {
    for (const phase of ALL_PHASES) {
      expect(getCurrentPhase(PHASES_T[phase].startDate, TEST_RACE_DATE)).toBe(phase);
    }
  });

  it("treats phase end dates as inclusive", () => {
    for (const phase of ALL_PHASES) {
      expect(getCurrentPhase(PHASES_T[phase].endDate, TEST_RACE_DATE)).toBe(phase);
    }
  });

  it("flips phase exactly on the boundary day", () => {
    for (let i = 1; i < ALL_PHASES.length; i++) {
      const prev = ALL_PHASES[i - 1];
      const next = ALL_PHASES[i];
      expect(getCurrentPhase(PHASES_T[prev].endDate, TEST_RACE_DATE)).toBe(prev);
      expect(getCurrentPhase(addDays(PHASES_T[prev].endDate, 1), TEST_RACE_DATE)).toBe(next);
    }
  });

  it("ignores time-of-day on a boundary date", () => {
    expect(getCurrentPhase(at(PHASES_T.adapt.endDate, 23, 59), TEST_RACE_DATE)).toBe("adapt");
    expect(getCurrentPhase(at(PHASES_T.burn.startDate, 0, 1), TEST_RACE_DATE)).toBe("burn");
  });

  it("clamps dates before the build to adapt", () => {
    expect(getCurrentPhase(addDays(PHASES_T.adapt.startDate, -21), TEST_RACE_DATE)).toBe("adapt");
    expect(getCurrentPhase(addDays(PHASES_T.adapt.startDate, -203), TEST_RACE_DATE)).toBe("adapt");
  });

  it("tapers through race week, then holds at peak after the race", () => {
    expect(getCurrentPhase(addDays(PHASES_T.peak.endDate, 1), TEST_RACE_DATE)).toBe("taper");
    expect(getCurrentPhase(TEST_RACE_DATE, TEST_RACE_DATE)).toBe("taper"); // race day
    expect(getCurrentPhase(addDays(TEST_RACE_DATE, 11), TEST_RACE_DATE)).toBe("peak");
  });

  it("only tapers in the final <21 days once the peak block is over", () => {
    // Inside the peak block the dated block wins, even within 21 days of the race.
    expect(getCurrentPhase(midOf("peak"), TEST_RACE_DATE)).toBe("peak");
    expect(getCurrentPhase(PHASES_T.peak.endDate, TEST_RACE_DATE)).toBe("peak");
    // The moment the block ends, the run-in becomes a taper.
    expect(getCurrentPhase(addDays(PHASES_T.peak.endDate, 1), TEST_RACE_DATE)).toBe("taper");
    expect(getCurrentPhase(addDays(TEST_RACE_DATE, -1), TEST_RACE_DATE)).toBe("taper");
  });

  it("keeps ordering correct for dates well after the peak block", () => {
    // Exercises the day-ordering key across month- and year-rollovers past peak.
    expect(getCurrentPhase(at(addDays(PHASES_T.peak.endDate, 1), 0, 1), TEST_RACE_DATE)).toBe(
      "taper"
    );
    expect(getCurrentPhase(addDays(TEST_RACE_DATE, 102), TEST_RACE_DATE)).toBe("peak"); // year end
    expect(getCurrentPhase(addDays(TEST_RACE_DATE, 103), TEST_RACE_DATE)).toBe("peak"); // rollover
    expect(getCurrentPhase(addDays(TEST_RACE_DATE, 1364), TEST_RACE_DATE)).toBe("peak"); // far future
  });

  it("defaults to the system clock when no date is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(midOf("burn"));
    expect(getCurrentPhase()).toBe("burn");
    vi.setSystemTime(midOf("peak"));
    expect(getCurrentPhase()).toBe("peak");
  });
});

describe("getPhaseRules — phase rules", () => {
  it.each(ALL_PHASES)("returns the matching, well-formed rules for %s", (key) => {
    const rules = getPhaseRules(key, TEST_RACE_DATE);
    expect(rules.phase).toBe(key);
    expect(rules.startDate.getTime()).toBeLessThan(rules.endDate.getTime());
    expect(rules.minDistanceKm).toBeLessThanOrEqual(rules.maxDistanceKm);
    expect(rules.sessionsPerWeek).toBeGreaterThanOrEqual(4);
  });

  it("requires Zone 2 only in the adapt and burn base phases", () => {
    expect(getPhaseRules("adapt", TEST_RACE_DATE).zone2Required).toBe(true);
    expect(getPhaseRules("burn", TEST_RACE_DATE).zone2Required).toBe(true);
    expect(getPhaseRules("sharpen", TEST_RACE_DATE).zone2Required).toBe(false);
    expect(getPhaseRules("peak", TEST_RACE_DATE).zone2Required).toBe(false);
  });

  it("caps the long run at 16 km in base and 18 km in sharpen/peak", () => {
    expect(getPhaseRules("adapt", TEST_RACE_DATE).longRunMaxKm).toBe(16);
    expect(getPhaseRules("burn", TEST_RACE_DATE).longRunMaxKm).toBe(16);
    expect(getPhaseRules("sharpen", TEST_RACE_DATE).longRunMaxKm).toBe(18);
    expect(getPhaseRules("peak", TEST_RACE_DATE).longRunMaxKm).toBe(18);
  });

  it("introduces the tempo session in sharpen and the long run in peak", () => {
    expect(getPhaseRules("adapt", TEST_RACE_DATE).hasTempoSession).toBe(false);
    expect(getPhaseRules("sharpen", TEST_RACE_DATE).hasTempoSession).toBe(true);
    expect(getPhaseRules("adapt", TEST_RACE_DATE).hasLongRun).toBe(false);
    expect(getPhaseRules("peak", TEST_RACE_DATE).hasLongRun).toBe(true);
  });

  it("models the table's session distances for the base phases", () => {
    expect(getPhaseRules("adapt", TEST_RACE_DATE)).toMatchObject({
      minDistanceKm: 6,
      maxDistanceKm: 8,
    });
    expect(getPhaseRules("burn", TEST_RACE_DATE)).toMatchObject({
      minDistanceKm: 8,
      maxDistanceKm: 10,
    });
  });

  it("lays the phases out contiguously, with no gap or overlap", () => {
    for (let i = 1; i < ALL_PHASES.length; i++) {
      const prevEnd = PHASES_T[ALL_PHASES[i - 1]].endDate;
      expect(getCurrentPhase(addDays(prevEnd, 1), TEST_RACE_DATE)).toBe(ALL_PHASES[i]);
    }
  });
});

describe("getWeekPlan", () => {
  it("lays out a full Mon–Sun week", () => {
    for (const phase of ALL_PHASES) {
      const week = getWeekPlan(phase, undefined, TEST_RACE_DATE);
      expect(week.map((s) => s.weekday)).toEqual([...WEEKDAYS]);
    }
  });

  it("schedules exactly the phase's sessionsPerWeek run days", () => {
    for (const phase of ALL_PHASES) {
      const runs = getWeekPlan(phase, undefined, TEST_RACE_DATE).filter((s) => s.type !== "rest");
      expect(runs).toHaveLength(getPhaseRules(phase, TEST_RACE_DATE).sessionsPerWeek);
    }
  });

  it("keeps the base phases all-easy in Zone 2 with no tempo or long run", () => {
    for (const phase of ["adapt", "burn"] as PhaseKey[]) {
      const runs = getWeekPlan(phase, undefined, TEST_RACE_DATE).filter((s) => s.type !== "rest");
      expect(runs.every((s) => s.type === "easy" && s.zone === 2)).toBe(true);
    }
  });

  it("adds a Wednesday tempo in sharpen but still no long run", () => {
    const week = getWeekPlan("sharpen", undefined, TEST_RACE_DATE);
    const tempo = week.find((s) => s.type === "tempo");
    expect(tempo?.weekday).toBe("wed");
    expect(week.some((s) => s.type === "long")).toBe(false);
  });

  it("adds both a Wednesday tempo and a Sunday long run in peak", () => {
    const week = getWeekPlan("peak", undefined, TEST_RACE_DATE);
    expect(week.find((s) => s.type === "tempo")?.weekday).toBe("wed");
    const long = week.find((s) => s.type === "long");
    expect(long?.weekday).toBe("sun");
    expect(long?.distanceKm).toBe(getPhaseRules("peak", TEST_RACE_DATE).longRunMaxKm);
  });

  it("leaves dates unset without a start, and stamps consecutive days with one", () => {
    expect(getWeekPlan("burn", undefined, TEST_RACE_DATE).every((s) => s.date === undefined)).toBe(
      true
    );

    const monday = weekdayIn("burn", 1);
    const week = getWeekPlan("burn", monday, TEST_RACE_DATE);
    week.forEach((session, i) => {
      expect(session.date).toEqual(addDays(monday, i));
    });
  });

  it("produces a plan that never self-violates its own phase constraints", () => {
    for (const phase of ALL_PHASES) {
      for (const session of getWeekPlan(phase, undefined, TEST_RACE_DATE)) {
        if (session.type === "rest") continue;
        const result = validateWorkout({
          plannedDate: BURN_WEDNESDAY,
          phase,
          plannedType: session.type,
          plannedZone: session.zone,
          plannedDistanceKm: session.distanceKm,
          raceDate: TEST_RACE_DATE,
        });
        expect(result.valid).toBe(true);
      }
    }
  });

  it("spaces every run so the plan respects its own recovery windows", () => {
    // Validate each run day against the previous run day — including the wrap
    // from Sunday into the next week's Monday. 5-session weeks live on the
    // 24 h easy window; the Wednesday tempo must still get 48 h clear.
    const monday = at(weekdayIn("burn", 1), 8);
    for (const phase of ALL_PHASES) {
      const week = getWeekPlan(phase, monday, TEST_RACE_DATE);
      const runs = week.filter((s) => s.type !== "rest");
      const nextMonday = new Date(monday);
      nextMonday.setDate(nextMonday.getDate() + 7);
      const pairs = runs.slice(1).map((session, i) => [runs[i], session] as const);
      // Sunday → next Monday: the week repeats, so the wrap must hold too.
      pairs.push([runs[runs.length - 1], { ...runs[0], date: nextMonday }]);

      for (const [prev, session] of pairs) {
        const result = validateWorkout({
          plannedDate: session.date as Date,
          phase,
          plannedType: session.type,
          plannedZone: session.zone,
          plannedDistanceKm: session.distanceKm,
          lastRunDate: prev.date,
          raceDate: TEST_RACE_DATE,
        });
        expect(
          result.issues.map((i) => i.constraintId),
          `${phase}: ${prev.weekday} → ${session.weekday}`
        ).not.toContain("recovery-window");
      }
    }
  });
});

describe("getWeekPlan — taper & race week (B4)", () => {
  // The Monday of the week the race falls in, for any race weekday.
  function raceWeekMonday(race: Date): Date {
    return addDays(race, -((race.getDay() + 6) % 7));
  }

  it("keeps a general taper week to at most 3 easy Zone-2 days, no hard efforts", () => {
    const monday = addDays(raceWeekMonday(TEST_RACE_DATE), -7); // taper shape, race not in-week
    const week = getWeekPlan("taper", monday, TEST_RACE_DATE);
    const runs = week.filter((s) => s.type !== "rest");
    expect(runs.length).toBeLessThanOrEqual(3);
    expect(runs.every((s) => s.type === "easy" && s.zone === 2)).toBe(true);
    expect(week.some((s) => s.type === "tempo" || s.type === "long")).toBe(false);
  });

  it("caps every taper session at ~60% of a normal week's distance", () => {
    const monday = addDays(raceWeekMonday(TEST_RACE_DATE), -7);
    const week = getWeekPlan("taper", monday, TEST_RACE_DATE);
    for (const session of week) {
      if (session.distanceKm != null) {
        expect(session.distanceKm).toBeLessThanOrEqual(
          getPhaseRules("taper", TEST_RACE_DATE).maxDistanceKm
        );
      }
    }
  });

  it("lays out race week: race day, a short shakeout the day before, a rest day before that", () => {
    const monday = raceWeekMonday(TEST_RACE_DATE);
    const week = getWeekPlan("taper", monday, TEST_RACE_DATE);
    const raceIndex = week.findIndex((s) => s.type === "race");
    expect(raceIndex).toBe(daysBetween(monday, TEST_RACE_DATE));
    expect(week[raceIndex - 1].type).toBe("easy"); // shakeout the day before
    expect(week[raceIndex - 1].distanceKm).toBeLessThanOrEqual(2);
    expect(week[raceIndex - 2].type).toBe("rest"); // rest before the shakeout
    const runDaysExclRace = week.filter((s) => s.type !== "rest" && s.type !== "race");
    expect(runDaysExclRace).toHaveLength(2);
  });

  it("anchors race week to the parameterised race, mid-week races included", () => {
    // A Wednesday race in 2027: the race lands mid-strip, shakeout Tuesday.
    let race = new Date(2027, 9, 1);
    while (race.getDay() !== 3) race = addDays(race, 1);
    const monday = raceWeekMonday(race);
    const week = getWeekPlan("taper", monday, race);
    expect(week[2].type).toBe("race"); // Wednesday
    expect(week[1].type).toBe("easy"); // Tuesday shakeout
    expect(week[0].type).toBe("rest"); // Monday rest
  });

  it("names race day after the parameterised race", () => {
    const monday = raceWeekMonday(TEST_RACE_DATE);
    const week = getWeekPlan("taper", monday, TEST_RACE_DATE, "CPH Half");
    const race = week.find((s) => s.type === "race");
    expect(race?.description).toBe("Race — CPH Half");
  });
});

describe("validateWorkout — soft: high-risk session (B2)", () => {
  it("warns when a high-risk session carries a hard effort", () => {
    const result = validateWorkout(ctx({ phase: "sharpen", plannedType: "tempo", risk: "high" }));
    expect(result.valid).toBe(true); // soft — never blocks
    expect(result.warnings.map((w) => w.constraintId)).toContain("high-risk-session");
  });

  it("stays quiet on a high-risk easy run", () => {
    const result = validateWorkout(ctx({ plannedType: "easy", risk: "high" }));
    expect(result.warnings.map((w) => w.constraintId)).not.toContain("high-risk-session");
  });

  it("stays quiet when risk is low or unset", () => {
    const low = validateWorkout(ctx({ phase: "sharpen", plannedType: "tempo", risk: "low" }));
    const unset = validateWorkout(ctx({ phase: "sharpen", plannedType: "tempo" }));
    expect(low.warnings.map((w) => w.constraintId)).not.toContain("high-risk-session");
    expect(unset.warnings.map((w) => w.constraintId)).not.toContain("high-risk-session");
  });
});

describe("getActiveConstraints", () => {
  it("activates the Zone-2 base rules in adapt and burn", () => {
    for (const phase of ["adapt", "burn"] as PhaseKey[]) {
      const ids = getActiveConstraints(phase).map((c) => c.id);
      expect(ids).toContain("zone2-hr-ceiling");
      expect(ids).toContain("base-phase-zone2");
      expect(getActiveConstraints(phase)).toHaveLength(ALL_CONSTRAINTS.length);
    }
  });

  it("drops the Zone-2 base rules in sharpen and peak", () => {
    for (const phase of ["sharpen", "peak"] as PhaseKey[]) {
      const ids = getActiveConstraints(phase).map((c) => c.id);
      expect(ids).not.toContain("zone2-hr-ceiling");
      expect(ids).not.toContain("base-phase-zone2");
      expect(getActiveConstraints(phase)).toHaveLength(ALL_CONSTRAINTS.length - 2);
    }
  });

  it("gives every constraint a complete, well-typed definition", () => {
    for (const c of ALL_CONSTRAINTS) {
      expect(c.id).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(c.category).toBeTruthy();
      expect(["hard", "soft", "phase", "safety"]).toContain(c.severity);
      expect(typeof c.evaluate).toBe("function");
    }
  });

  it("uses unique constraint ids", () => {
    const ids = ALL_CONSTRAINTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("validateWorkout — hard: recovery window", () => {
  it("blocks an easy run only 12 h after the last one", () => {
    const result = validateWorkout(ctx({ plannedType: "easy", lastRunDate: hoursBefore(12) }));
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.constraintId === "recovery-window");
    expect(issue?.message).toContain(String(EASY_MIN_RECOVERY_HOURS));
  });

  it("allows an easy run at exactly the 24 h mark", () => {
    const result = validateWorkout(ctx({ plannedType: "easy", lastRunDate: hoursBefore(24) }));
    expect(result.valid).toBe(true);
  });

  it("blocks a quality session only 24 h after the last run", () => {
    const result = validateWorkout(
      ctx({ phase: "sharpen", plannedType: "tempo", lastRunDate: hoursBefore(24) })
    );
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.constraintId === "recovery-window");
    expect(issue?.message).toContain(String(MIN_RECOVERY_HOURS));
  });

  it("allows a quality session at exactly the 48 h mark", () => {
    const result = validateWorkout(
      ctx({ phase: "sharpen", plannedType: "tempo", lastRunDate: hoursBefore(48) })
    );
    expect(result.issues.map((i) => i.constraintId)).not.toContain("recovery-window");
  });

  it("allows a run well clear of the window (72 h)", () => {
    const result = validateWorkout(ctx({ plannedType: "easy", lastRunDate: hoursBefore(72) }));
    expect(result.issues).toHaveLength(0);
  });

  it("does not fire on a non-run day, however recent the last run", () => {
    const result = validateWorkout(ctx({ plannedType: "rest", lastRunDate: hoursBefore(2) }));
    expect(result.issues.map((i) => i.constraintId)).not.toContain("recovery-window");
  });

  it("does not fire when no previous run is known", () => {
    const result = validateWorkout(ctx({ plannedType: "easy" }));
    expect(result.issues.map((i) => i.constraintId)).not.toContain("recovery-window");
  });
});

describe("validateWorkout — hard: Zone 2 ceiling", () => {
  it("blocks Zone 3+ work in a base phase", () => {
    const result = validateWorkout(ctx({ phase: "adapt", plannedZone: 3 }));
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.constraintId)).toContain("zone2-hr-ceiling");
  });

  it("allows a Zone 2 effort in a base phase", () => {
    const result = validateWorkout(ctx({ phase: "adapt", plannedZone: 2 }));
    expect(result.issues.map((i) => i.constraintId)).not.toContain("zone2-hr-ceiling");
  });

  it("permits Zone 4 once out of the base phases (sharpen)", () => {
    const result = validateWorkout(ctx({ phase: "sharpen", plannedZone: 4 }));
    expect(result.valid).toBe(true);
  });

  it("references the absolute 155 bpm ceiling in its message", () => {
    const result = validateWorkout(ctx({ phase: "burn", plannedZone: 4 }));
    const issue = result.issues.find((i) => i.constraintId === "zone2-hr-ceiling");
    expect(issue?.message).toContain(String(ZONE2_CEILING_BPM));
  });
});

describe("validateWorkout — hard: no strength on run days", () => {
  it("blocks leg strength on a typed run day", () => {
    const result = validateWorkout(ctx({ plannedType: "easy", includesStrength: true }));
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.constraintId)).toContain("no-strength-on-run-days");
  });

  it("infers a run day from planned distance when no type is given", () => {
    const result = validateWorkout(ctx({ plannedDistanceKm: 8, includesStrength: true }));
    expect(result.issues.map((i) => i.constraintId)).toContain("no-strength-on-run-days");
  });

  it("allows leg strength on a rest / strength day", () => {
    const rest = validateWorkout(ctx({ plannedType: "rest", includesStrength: true }));
    const strength = validateWorkout(ctx({ plannedType: "strength", includesStrength: true }));
    expect(rest.valid).toBe(true);
    expect(strength.valid).toBe(true);
  });

  it("does nothing when no strength is planned", () => {
    const result = validateWorkout(ctx({ plannedType: "easy", includesStrength: false }));
    expect(result.issues).toHaveLength(0);
  });
});

describe("validateWorkout — hard: Adios Pro 4 shoe", () => {
  it("blocks the race shoe on an easy run", () => {
    const result = validateWorkout(ctx({ plannedType: "easy", shoeType: "adios_pro" }));
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.constraintId)).toContain("adios-pro-speed-only");
  });

  it("allows the race shoe for intervals", () => {
    const result = validateWorkout(
      ctx({ phase: "sharpen", plannedType: "intervals", shoeType: "adios_pro" })
    );
    expect(result.valid).toBe(true);
  });

  it("does not touch other shoes on easy days", () => {
    const result = validateWorkout(ctx({ plannedType: "easy", shoeType: "vomero" }));
    expect(result.issues.map((i) => i.constraintId)).not.toContain("adios-pro-speed-only");
  });

  it("stays graceful when the session type is unknown", () => {
    const result = validateWorkout(ctx({ shoeType: "adios_pro" }));
    expect(result.issues.map((i) => i.constraintId)).not.toContain("adios-pro-speed-only");
  });
});

describe("validateWorkout — session type casing", () => {
  // Loosely-cased strings stand in for untyped callers (AI tool output, form
  // input) that reach the engine before normalisation — hence the casts.
  it("recognises speed sessions regardless of casing", () => {
    const result = validateWorkout(
      ctx({ phase: "sharpen", plannedType: "Intervals" as SessionType, shoeType: "adios_pro" })
    );
    expect(result.valid).toBe(true);
  });

  it("applies the long-run cap to a capitalised 'Long' type", () => {
    const result = validateWorkout(
      ctx({ phase: "burn", plannedType: "Long" as SessionType, plannedDistanceKm: 17 })
    );
    expect(result.issues.map((i) => i.constraintId)).toContain("long-run-cap");
  });

  it("treats an uppercase 'REST' day as a non-run day for strength", () => {
    const result = validateWorkout(
      ctx({ plannedType: "REST" as SessionType, includesStrength: true })
    );
    expect(result.valid).toBe(true);
  });

  it("flags base-phase quality work for a capitalised 'Tempo'", () => {
    const result = validateWorkout(ctx({ phase: "burn", plannedType: "Tempo" as SessionType }));
    expect(result.warnings.map((w) => w.constraintId)).toContain("base-phase-zone2");
  });
});

describe("validateWorkout — hard: long-run cap", () => {
  it("blocks a 17 km long run in a base phase (cap 16)", () => {
    const result = validateWorkout(
      ctx({ phase: "burn", plannedType: "long", plannedDistanceKm: 17 })
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.constraintId)).toContain("long-run-cap");
  });

  it("allows that same 17 km long run in peak (cap 18)", () => {
    const result = validateWorkout(
      ctx({ phase: "peak", plannedType: "long", plannedDistanceKm: 17 })
    );
    expect(result.valid).toBe(true);
  });

  it("blocks a 19 km long run even in peak", () => {
    const result = validateWorkout(
      ctx({ phase: "peak", plannedType: "long", plannedDistanceKm: 19 })
    );
    expect(result.issues.map((i) => i.constraintId)).toContain("long-run-cap");
  });

  it("allows a long run sitting exactly on the cap", () => {
    const result = validateWorkout(
      ctx({ phase: "sharpen", plannedType: "long", plannedDistanceKm: 18 })
    );
    expect(result.valid).toBe(true);
  });

  it("only governs long runs, not long easy distances of another type", () => {
    const result = validateWorkout(
      ctx({ phase: "burn", plannedType: "easy", plannedDistanceKm: 20 })
    );
    expect(result.issues.map((i) => i.constraintId)).not.toContain("long-run-cap");
  });
});

describe("validateWorkout — soft: football the day before", () => {
  it("warns (without blocking) before a hard session after football", () => {
    const result = validateWorkout(
      ctx({ phase: "sharpen", plannedType: "tempo", footballYesterday: true })
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.constraintId)).toContain("football-recovery");
  });

  it("warns on a high-zone effort flagged only by zone", () => {
    const result = validateWorkout(ctx({ phase: "peak", plannedZone: 4, footballYesterday: true }));
    expect(result.warnings.map((w) => w.constraintId)).toContain("football-recovery");
  });

  it("stays quiet before an easy run after football", () => {
    const result = validateWorkout(ctx({ plannedType: "easy", footballYesterday: true }));
    expect(result.warnings.map((w) => w.constraintId)).not.toContain("football-recovery");
  });
});

describe("validateWorkout — phase: base-phase Zone 2 guidance", () => {
  it("warns about quality work during a base phase", () => {
    const result = validateWorkout(ctx({ phase: "burn", plannedType: "tempo" }));
    expect(result.warnings.map((w) => w.constraintId)).toContain("base-phase-zone2");
    expect(result.valid).toBe(true); // a phase warning never blocks
  });

  it("stays silent about quality work once in the sharpen phase", () => {
    const result = validateWorkout(ctx({ phase: "sharpen", plannedType: "tempo" }));
    expect(result.warnings.map((w) => w.constraintId)).not.toContain("base-phase-zone2");
  });
});

describe("validateWorkout — safety: weekly progression", () => {
  it("warns when weekly volume jumps more than 10%", () => {
    const result = validateWorkout(
      ctx({ plannedType: "easy", previousWeekDistanceKm: 50, weeklyDistanceKm: 60 })
    );
    expect(result.warnings.map((w) => w.constraintId)).toContain("weekly-distance-progression");
    expect(result.valid).toBe(true);
  });

  it("allows a step-up sitting on the 10% line", () => {
    const result = validateWorkout(
      ctx({
        plannedType: "easy",
        previousWeekDistanceKm: 50,
        weeklyDistanceKm: 50 * MAX_WEEKLY_INCREASE_RATIO,
      })
    );
    expect(result.warnings.map((w) => w.constraintId)).not.toContain("weekly-distance-progression");
  });

  it("does not fire without a previous-week baseline", () => {
    const noPrev = validateWorkout(ctx({ plannedType: "easy", weeklyDistanceKm: 60 }));
    const zeroPrev = validateWorkout(
      ctx({ plannedType: "easy", previousWeekDistanceKm: 0, weeklyDistanceKm: 60 })
    );
    expect(noPrev.warnings.map((w) => w.constraintId)).not.toContain("weekly-distance-progression");
    expect(zeroPrev.warnings.map((w) => w.constraintId)).not.toContain(
      "weekly-distance-progression"
    );
  });
});

describe("serializeValidationResult", () => {
  it("summarises a clean result, warnings, and hard blocks", () => {
    const clean = serializeValidationResult(validateWorkout(ctx()));
    expect(clean.summary).toBe("Godkendt");

    // A base-phase tempo trips exactly one (phase) warning.
    const warned = serializeValidationResult(validateWorkout(ctx({ plannedType: "tempo" })));
    expect(warned.summary).toBe("Godkendt med 1 advarsel");

    const blocked = serializeValidationResult(
      validateWorkout(ctx({ plannedType: "easy", lastRunDate: hoursBefore(12) }))
    );
    expect(blocked.summary).toBe("1 blokerende problem");
  });

  it("stays a plain JSON round-trippable object", () => {
    const serialized = serializeValidationResult(
      validateWorkout(ctx({ plannedType: "tempo", footballYesterday: true }))
    );
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
  });
});

describe("validateWorkout — result structure & edge cases", () => {
  it("passes a clean, minimal context", () => {
    const result = validateWorkout(ctx());
    expect(result).toMatchObject({ valid: true, issues: [], warnings: [] });
  });

  it("never throws on a context with only the required fields", () => {
    expect(() => validateWorkout({ plannedDate: BURN_WEDNESDAY, phase: "peak" })).not.toThrow();
  });

  it("keeps hard violations out of warnings and soft ones out of issues", () => {
    const result = validateWorkout(
      ctx({
        plannedType: "tempo",
        lastRunDate: hoursBefore(12), // hard block
        footballYesterday: true, // soft warning
      })
    );
    expect(result.issues.every((i) => i.severity === "hard")).toBe(true);
    expect(result.warnings.every((w) => w.severity !== "hard")).toBe(true);
  });

  it("is invalid when a hard issue is present but valid with warnings alone", () => {
    const warned = validateWorkout(ctx({ plannedType: "tempo" })); // base-phase warning
    const blocked = validateWorkout(ctx({ plannedType: "easy", lastRunDate: hoursBefore(12) }));
    expect(warned.valid).toBe(true);
    expect(warned.warnings.length).toBeGreaterThan(0);
    expect(blocked.valid).toBe(false);
  });

  it("accumulates several independent hard issues at once", () => {
    const result = validateWorkout(
      ctx({
        phase: "adapt",
        plannedType: "easy",
        plannedZone: 4, // Zone 2 ceiling
        includesStrength: true, // strength on a run day
        shoeType: "adios_pro", // race shoe on an easy day
        lastRunDate: hoursBefore(12), // inside every window
      })
    );
    expect(result.valid).toBe(false);
    const ids = result.issues.map((i) => i.constraintId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "zone2-hr-ceiling",
        "no-strength-on-run-days",
        "adios-pro-speed-only",
        "recovery-window",
      ])
    );
  });

  it("tags every issue and warning with a matching, known constraint id", () => {
    const knownIds = new Set(ALL_CONSTRAINTS.map((c) => c.id));
    const result = validateWorkout(
      ctx({ phase: "burn", plannedType: "tempo", footballYesterday: true })
    );
    for (const entry of [...result.issues, ...result.warnings]) {
      expect(knownIds.has(entry.constraintId)).toBe(true);
    }
  });
});
