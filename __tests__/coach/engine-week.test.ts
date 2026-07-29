import { describe, expect, it } from "vitest";
import {
  DEFAULT_RACE_DATE,
  EASY_MIN_RECOVERY_HOURS,
  getWeekPlan,
  MIN_RECOVERY_HOURS,
  type PhaseKey,
  type PlannedSession,
} from "@/lib/coach/engine";

// Issue #211 part 1 — the generated week must be varied (not four identical easy
// days) while still respecting the recovery windows the layout is built around.

/** A Monday to stamp concrete dates on the week (7 Jul 2025 is a Monday). */
const MONDAY = new Date(2025, 6, 7);
const PHASES: PhaseKey[] = ["adapt", "burn", "sharpen", "peak"];

/** Session types that need the full 48 h recovery window on both sides. */
const QUALITY = new Set(["tempo", "intervals", "race", "fartlek", "speed"]);

/** Every distinct "what is this day" descriptor — the subtype refines an easy run. */
function descriptor(session: PlannedSession): string {
  return session.easySubtype ?? session.type;
}

describe("getWeekPlan — variety (issue #211)", () => {
  it.each(PHASES)("gives %s at least three distinct session descriptors", (phase) => {
    const week = getWeekPlan(phase, MONDAY, DEFAULT_RACE_DATE);
    const kinds = new Set(week.map(descriptor));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it.each(PHASES)("varies the easy-day distance in %s — never all the minimum", (phase) => {
    const week = getWeekPlan(phase, MONDAY, DEFAULT_RACE_DATE);
    const easyKm = week.filter((s) => s.type === "easy").map((s) => s.distanceKm ?? 0);
    expect(easyKm.length).toBeGreaterThan(1);
    expect(new Set(easyKm).size).toBeGreaterThan(1);
  });

  it("makes the day after the peak long run a recovery jog", () => {
    const week = getWeekPlan("peak", MONDAY, DEFAULT_RACE_DATE);
    // Sunday (index 6) is the long run; Monday (index 0) comes after it.
    expect(week[6].type).toBe("long");
    expect(week[0].easySubtype).toBe("recovery");
  });

  it("marks the easy day before the peak long run for strides", () => {
    const week = getWeekPlan("peak", MONDAY, DEFAULT_RACE_DATE);
    // Saturday (index 5) is the last easy day before Sunday's long run.
    expect(week[5].easySubtype).toBe("easy-strides");
  });
});

/** Whole hours between two dated sessions — never `!`, so Biome stays happy. */
function hoursBetween(a: PlannedSession, b: PlannedSession): number {
  const ta = a.date?.getTime();
  const tb = b.date?.getTime();
  if (ta == null || tb == null) throw new Error("session is missing a stamped date");
  return Math.abs(ta - tb) / 3_600_000;
}

describe("getWeekPlan — recovery windows (issue #211)", () => {
  it.each(PHASES)("keeps every run in %s at least 24 h apart", (phase) => {
    const runs = getWeekPlan(phase, MONDAY, DEFAULT_RACE_DATE).filter((s) => s.type !== "rest");
    for (let i = 1; i < runs.length; i++) {
      expect(hoursBetween(runs[i], runs[i - 1])).toBeGreaterThanOrEqual(EASY_MIN_RECOVERY_HOURS);
    }
  });

  it.each(PHASES)("gives every quality session 48 h clear on both sides in %s", (phase) => {
    const week = getWeekPlan(phase, MONDAY, DEFAULT_RACE_DATE);
    const runs = week.filter((s) => s.type !== "rest");
    runs.forEach((session, pos) => {
      if (!QUALITY.has(session.type)) return;
      const before = runs[pos - 1];
      const after = runs[pos + 1];
      if (before) expect(hoursBetween(session, before)).toBeGreaterThanOrEqual(MIN_RECOVERY_HOURS);
      if (after) expect(hoursBetween(session, after)).toBeGreaterThanOrEqual(MIN_RECOVERY_HOURS);
    });
  });

  it("allows the Sat→Sun 24 h gap in peak (two easy/long efforts, not quality)", () => {
    const week = getWeekPlan("peak", MONDAY, DEFAULT_RACE_DATE);
    expect(hoursBetween(week[6], week[5])).toBe(EASY_MIN_RECOVERY_HOURS);
    expect(QUALITY.has(week[5].type)).toBe(false);
    expect(QUALITY.has(week[6].type)).toBe(false);
  });
});
