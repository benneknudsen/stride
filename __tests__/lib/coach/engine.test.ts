import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_CONSTRAINTS,
  getActiveConstraints,
  getCurrentPhase,
  getPhase,
  MAX_WEEKLY_INCREASE_RATIO,
  MIN_RECOVERY_HOURS,
  PHASES,
  type PhaseKey,
  POOR_SLEEP_HR_BUMP_BPM,
  POOR_SLEEP_PACE_ADJUSTMENT,
  RACE_DATE,
  validateWorkout,
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

describe("validateWorkout — hard: 48 h recovery", () => {
  it("blocks a run only 24 h after the last one", () => {
    const result = validateWorkout(
      ctx({ plannedType: "easy", lastRunDate: new Date(2026, 6, 14, 8, 0) })
    );
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.constraintId === "recovery-48h");
    expect(issue?.message).toContain(String(MIN_RECOVERY_HOURS));
  });

  it("allows a run at exactly the 48 h mark", () => {
    const result = validateWorkout(
      ctx({ plannedType: "easy", lastRunDate: new Date(2026, 6, 13, 8, 0) })
    );
    expect(result.valid).toBe(true);
  });

  it("allows a run well clear of the window (72 h)", () => {
    const result = validateWorkout(
      ctx({ plannedType: "easy", lastRunDate: new Date(2026, 6, 12, 8, 0) })
    );
    expect(result.issues).toHaveLength(0);
  });

  it("does not fire when no previous run is known", () => {
    const result = validateWorkout(ctx({ plannedType: "easy" }));
    expect(result.issues.map((i) => i.constraintId)).not.toContain("recovery-48h");
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

describe("validateWorkout — soft: poor sleep", () => {
  it("warns and emits HR + pace adjustments on poor sleep", () => {
    const result = validateWorkout(ctx({ plannedType: "easy", sleepQuality: "poor" }));
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.constraintId)).toContain("sleep-hr-adjustment");
    expect(result.hrAdjustmentBpm).toBe(POOR_SLEEP_HR_BUMP_BPM);
    expect(result.paceAdjustment).toBe(POOR_SLEEP_PACE_ADJUSTMENT);
  });

  it("leaves adjustments unset for good or ok sleep", () => {
    for (const sleepQuality of ["good", "ok"] as const) {
      const result = validateWorkout(ctx({ plannedType: "easy", sleepQuality }));
      expect(result.hrAdjustmentBpm).toBeUndefined();
      expect(result.paceAdjustment).toBeUndefined();
      expect(result.warnings.map((w) => w.constraintId)).not.toContain("sleep-hr-adjustment");
    }
  });

  it("leaves adjustments unset when sleep is not reported", () => {
    const result = validateWorkout(ctx({ plannedType: "easy" }));
    expect(result.hrAdjustmentBpm).toBeUndefined();
    expect(result.paceAdjustment).toBeUndefined();
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

describe("validateWorkout — result structure & edge cases", () => {
  it("passes a clean, minimal context", () => {
    const result = validateWorkout(ctx());
    expect(result).toMatchObject({ valid: true, issues: [], warnings: [] });
    expect(result.hrAdjustmentBpm).toBeUndefined();
  });

  it("never throws on a context with only the required fields", () => {
    expect(() =>
      validateWorkout({ plannedDate: new Date(2026, 6, 15), phase: "peak" })
    ).not.toThrow();
  });

  it("keeps hard violations out of warnings and soft ones out of issues", () => {
    const result = validateWorkout(
      ctx({
        plannedType: "easy",
        lastRunDate: new Date(2026, 6, 14, 8, 0), // 24 h — hard block
        sleepQuality: "poor", // soft warning
      })
    );
    expect(result.issues.every((i) => i.severity === "hard")).toBe(true);
    expect(result.warnings.every((w) => w.severity !== "hard")).toBe(true);
  });

  it("is invalid when a hard issue is present but valid with warnings alone", () => {
    const warned = validateWorkout(ctx({ plannedType: "easy", sleepQuality: "poor" }));
    const blocked = validateWorkout(
      ctx({ plannedType: "easy", lastRunDate: new Date(2026, 6, 14, 8, 0) })
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
        lastRunDate: new Date(2026, 6, 14, 8, 0), // inside 48 h
      })
    );
    expect(result.valid).toBe(false);
    const ids = result.issues.map((i) => i.constraintId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "zone2-hr-ceiling",
        "no-strength-on-run-days",
        "adios-pro-speed-only",
        "recovery-48h",
      ])
    );
  });

  it("tags every issue and warning with a matching, known constraint id", () => {
    const knownIds = new Set(ALL_CONSTRAINTS.map((c) => c.id));
    const result = validateWorkout(
      ctx({ phase: "burn", plannedType: "tempo", sleepQuality: "poor" })
    );
    for (const entry of [...result.issues, ...result.warnings]) {
      expect(knownIds.has(entry.constraintId)).toBe(true);
    }
  });
});
