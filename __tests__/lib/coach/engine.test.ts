import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_CONSTRAINTS,
  EASY_MIN_RECOVERY_HOURS,
  getActiveConstraints,
  getCurrentPhase,
  getPhase,
  getWeekPlan,
  MAX_WEEKLY_INCREASE_RATIO,
  MIN_RECOVERY_HOURS,
  PHASES,
  type PhaseKey,
  RACE_DATE,
  type SessionType,
  serializeValidationResult,
  validateWorkout,
  WEEKDAYS,
  type WorkoutContext,
  ZONE2_CEILING_BPM,
} from "@/lib/coach/engine";

/** A clean, fully-recovered burn-phase context; override only what a test needs. */
function ctx(overrides: Partial<WorkoutContext> = {}): WorkoutContext {
  return {
    plannedDate: new Date(2026, 6, 15, 8, 0), // 15 Jul 2026 — burn phase
    phase: "burn",
    ...overrides,
  };
}

const ALL_PHASES: PhaseKey[] = ["adapt", "burn", "sharpen", "peak"];

afterEach(() => {
  vi.useRealTimers();
});

describe("getCurrentPhase — phase windows", () => {
  it("maps a mid-block date to each phase", () => {
    expect(getCurrentPhase(new Date(2026, 5, 28))).toBe("adapt"); // 28 Jun
    expect(getCurrentPhase(new Date(2026, 6, 15))).toBe("burn"); // 15 Jul
    expect(getCurrentPhase(new Date(2026, 7, 10))).toBe("sharpen"); // 10 Aug
    expect(getCurrentPhase(new Date(2026, 8, 1))).toBe("peak"); // 1 Sep
  });

  it("treats phase start dates as inclusive", () => {
    expect(getCurrentPhase(new Date(2026, 5, 22))).toBe("adapt"); // 22 Jun
    expect(getCurrentPhase(new Date(2026, 6, 6))).toBe("burn"); // 6 Jul
    expect(getCurrentPhase(new Date(2026, 7, 3))).toBe("sharpen"); // 3 Aug
    expect(getCurrentPhase(new Date(2026, 7, 24))).toBe("peak"); // 24 Aug
  });

  it("treats phase end dates as inclusive", () => {
    expect(getCurrentPhase(new Date(2026, 6, 5))).toBe("adapt"); // 5 Jul
    expect(getCurrentPhase(new Date(2026, 7, 2))).toBe("burn"); // 2 Aug
    expect(getCurrentPhase(new Date(2026, 7, 23))).toBe("sharpen"); // 23 Aug
    expect(getCurrentPhase(new Date(2026, 8, 14))).toBe("peak"); // 14 Sep
  });

  it("flips phase exactly on the boundary day", () => {
    expect(getCurrentPhase(new Date(2026, 6, 5))).toBe("adapt"); // last adapt day
    expect(getCurrentPhase(new Date(2026, 6, 6))).toBe("burn"); // first burn day
    expect(getCurrentPhase(new Date(2026, 7, 2))).toBe("burn"); // last burn day
    expect(getCurrentPhase(new Date(2026, 7, 3))).toBe("sharpen"); // first sharpen day
    expect(getCurrentPhase(new Date(2026, 7, 23))).toBe("sharpen"); // last sharpen day
    expect(getCurrentPhase(new Date(2026, 7, 24))).toBe("peak"); // first peak day
  });

  it("ignores time-of-day on a boundary date", () => {
    expect(getCurrentPhase(new Date(2026, 6, 5, 23, 59))).toBe("adapt");
    expect(getCurrentPhase(new Date(2026, 6, 6, 0, 1))).toBe("burn");
  });

  it("clamps dates before the build to adapt", () => {
    expect(getCurrentPhase(new Date(2026, 5, 1))).toBe("adapt"); // 1 Jun, pre-plan
    expect(getCurrentPhase(new Date(2025, 11, 31))).toBe("adapt"); // prior year
  });

  it("holds at peak through race week and beyond", () => {
    expect(getCurrentPhase(new Date(2026, 8, 15))).toBe("peak"); // day after peak block
    expect(getCurrentPhase(RACE_DATE)).toBe("peak"); // 20 Sep race day
    expect(getCurrentPhase(new Date(2026, 9, 1))).toBe("peak"); // 1 Oct, post-race
  });

  it("keeps ordering correct for dates well after the peak block", () => {
    // Exercises the day-ordering key across month- and year-rollovers past peak.
    expect(getCurrentPhase(new Date(2026, 8, 15, 0, 1))).toBe("peak"); // 15 Sep, just after end
    expect(getCurrentPhase(new Date(2026, 11, 31))).toBe("peak"); // 31 Dec 2026
    expect(getCurrentPhase(new Date(2027, 0, 1))).toBe("peak"); // 1 Jan 2027 — year rollover
    expect(getCurrentPhase(new Date(2030, 5, 15))).toBe("peak"); // far future
  });

  it("defaults to the system clock when no date is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15)); // 15 Jul 2026 — burn
    expect(getCurrentPhase()).toBe("burn");
    vi.setSystemTime(new Date(2026, 8, 1)); // 1 Sep 2026 — peak
    expect(getCurrentPhase()).toBe("peak");
  });
});

describe("getPhase — phase rules", () => {
  it.each(ALL_PHASES)("returns the matching, well-formed rules for %s", (key) => {
    const rules = getPhase(key);
    expect(rules.phase).toBe(key);
    expect(rules.startDate.getTime()).toBeLessThan(rules.endDate.getTime());
    expect(rules.minDistanceKm).toBeLessThanOrEqual(rules.maxDistanceKm);
    expect(rules.sessionsPerWeek).toBeGreaterThanOrEqual(4);
  });

  it("requires Zone 2 only in the adapt and burn base phases", () => {
    expect(getPhase("adapt").zone2Required).toBe(true);
    expect(getPhase("burn").zone2Required).toBe(true);
    expect(getPhase("sharpen").zone2Required).toBe(false);
    expect(getPhase("peak").zone2Required).toBe(false);
  });

  it("caps the long run at 16 km in base and 18 km in sharpen/peak", () => {
    expect(getPhase("adapt").longRunMaxKm).toBe(16);
    expect(getPhase("burn").longRunMaxKm).toBe(16);
    expect(getPhase("sharpen").longRunMaxKm).toBe(18);
    expect(getPhase("peak").longRunMaxKm).toBe(18);
  });

  it("introduces the tempo session in sharpen and the long run in peak", () => {
    expect(getPhase("adapt").hasTempoSession).toBe(false);
    expect(getPhase("sharpen").hasTempoSession).toBe(true);
    expect(getPhase("adapt").hasLongRun).toBe(false);
    expect(getPhase("peak").hasLongRun).toBe(true);
  });

  it("models the table's session distances for the base phases", () => {
    expect(getPhase("adapt")).toMatchObject({ minDistanceKm: 6, maxDistanceKm: 8 });
    expect(getPhase("burn")).toMatchObject({ minDistanceKm: 8, maxDistanceKm: 10 });
  });

  it("lays the phases out contiguously, with no gap or overlap", () => {
    for (let i = 1; i < ALL_PHASES.length; i++) {
      const prevEnd = PHASES[ALL_PHASES[i - 1]].endDate;
      const dayAfter = new Date(prevEnd);
      dayAfter.setDate(dayAfter.getDate() + 1);
      expect(getCurrentPhase(dayAfter)).toBe(ALL_PHASES[i]);
    }
  });
});

describe("getWeekPlan", () => {
  it("lays out a full Mon–Sun week", () => {
    for (const phase of ALL_PHASES) {
      const week = getWeekPlan(phase);
      expect(week.map((s) => s.weekday)).toEqual([...WEEKDAYS]);
    }
  });

  it("schedules exactly the phase's sessionsPerWeek run days", () => {
    for (const phase of ALL_PHASES) {
      const runs = getWeekPlan(phase).filter((s) => s.type !== "rest");
      expect(runs).toHaveLength(getPhase(phase).sessionsPerWeek);
    }
  });

  it("keeps the base phases all-easy in Zone 2 with no tempo or long run", () => {
    for (const phase of ["adapt", "burn"] as PhaseKey[]) {
      const runs = getWeekPlan(phase).filter((s) => s.type !== "rest");
      expect(runs.every((s) => s.type === "easy" && s.zone === 2)).toBe(true);
    }
  });

  it("adds a Wednesday tempo in sharpen but still no long run", () => {
    const week = getWeekPlan("sharpen");
    const tempo = week.find((s) => s.type === "tempo");
    expect(tempo?.weekday).toBe("wed");
    expect(week.some((s) => s.type === "long")).toBe(false);
  });

  it("adds both a Wednesday tempo and a Sunday long run in peak", () => {
    const week = getWeekPlan("peak");
    expect(week.find((s) => s.type === "tempo")?.weekday).toBe("wed");
    const long = week.find((s) => s.type === "long");
    expect(long?.weekday).toBe("sun");
    expect(long?.distanceKm).toBe(getPhase("peak").longRunMaxKm);
  });

  it("leaves dates unset without a start, and stamps consecutive days with one", () => {
    expect(getWeekPlan("burn").every((s) => s.date === undefined)).toBe(true);

    const monday = new Date(2026, 6, 6); // 6 Jul 2026 — a Monday
    const week = getWeekPlan("burn", monday);
    week.forEach((session, i) => {
      expect(session.date?.getDate()).toBe(monday.getDate() + i);
    });
  });

  it("produces a plan that never self-violates its own phase constraints", () => {
    for (const phase of ALL_PHASES) {
      for (const session of getWeekPlan(phase)) {
        if (session.type === "rest") continue;
        const result = validateWorkout({
          plannedDate: new Date(2026, 6, 15),
          phase,
          plannedType: session.type,
          plannedZone: session.zone,
          plannedDistanceKm: session.distanceKm,
        });
        expect(result.valid).toBe(true);
      }
    }
  });

  it("spaces every run so the plan respects its own recovery windows", () => {
    // Validate each run day against the previous run day — including the wrap
    // from Sunday into the next week's Monday. 5-session weeks live on the
    // 24 h easy window; the Wednesday tempo must still get 48 h clear.
    const monday = new Date(2026, 6, 6, 8, 0); // a Monday, 08:00
    for (const phase of ALL_PHASES) {
      const week = getWeekPlan(phase, monday);
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
        });
        expect(
          result.issues.map((i) => i.constraintId),
          `${phase}: ${prev.weekday} → ${session.weekday}`
        ).not.toContain("recovery-window");
      }
    }
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
    const result = validateWorkout(
      ctx({ plannedType: "easy", lastRunDate: new Date(2026, 6, 14, 20, 0) })
    );
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.constraintId === "recovery-window");
    expect(issue?.message).toContain(String(EASY_MIN_RECOVERY_HOURS));
  });

  it("allows an easy run at exactly the 24 h mark", () => {
    const result = validateWorkout(
      ctx({ plannedType: "easy", lastRunDate: new Date(2026, 6, 14, 8, 0) })
    );
    expect(result.valid).toBe(true);
  });

  it("blocks a quality session only 24 h after the last run", () => {
    const result = validateWorkout(
      ctx({ phase: "sharpen", plannedType: "tempo", lastRunDate: new Date(2026, 6, 14, 8, 0) })
    );
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.constraintId === "recovery-window");
    expect(issue?.message).toContain(String(MIN_RECOVERY_HOURS));
  });

  it("allows a quality session at exactly the 48 h mark", () => {
    const result = validateWorkout(
      ctx({ phase: "sharpen", plannedType: "tempo", lastRunDate: new Date(2026, 6, 13, 8, 0) })
    );
    expect(result.issues.map((i) => i.constraintId)).not.toContain("recovery-window");
  });

  it("allows a run well clear of the window (72 h)", () => {
    const result = validateWorkout(
      ctx({ plannedType: "easy", lastRunDate: new Date(2026, 6, 12, 8, 0) })
    );
    expect(result.issues).toHaveLength(0);
  });

  it("does not fire on a non-run day, however recent the last run", () => {
    const result = validateWorkout(
      ctx({ plannedType: "rest", lastRunDate: new Date(2026, 6, 15, 6, 0) })
    );
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
      validateWorkout(ctx({ plannedType: "easy", lastRunDate: new Date(2026, 6, 14, 20, 0) }))
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
    expect(() =>
      validateWorkout({ plannedDate: new Date(2026, 6, 15), phase: "peak" })
    ).not.toThrow();
  });

  it("keeps hard violations out of warnings and soft ones out of issues", () => {
    const result = validateWorkout(
      ctx({
        plannedType: "tempo",
        lastRunDate: new Date(2026, 6, 14, 20, 0), // 12 h — hard block
        footballYesterday: true, // soft warning
      })
    );
    expect(result.issues.every((i) => i.severity === "hard")).toBe(true);
    expect(result.warnings.every((w) => w.severity !== "hard")).toBe(true);
  });

  it("is invalid when a hard issue is present but valid with warnings alone", () => {
    const warned = validateWorkout(ctx({ plannedType: "tempo" })); // base-phase warning
    const blocked = validateWorkout(
      ctx({ plannedType: "easy", lastRunDate: new Date(2026, 6, 14, 20, 0) })
    );
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
        lastRunDate: new Date(2026, 6, 14, 20, 0), // 12 h — inside every window
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
