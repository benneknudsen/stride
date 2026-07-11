import { describe, expect, it } from "vitest";
import { buildPhases, getPhaseRules, type PhaseKey } from "@/lib/coach/engine";
import {
  recommendWorkout,
  TEMPO_HR_CAP_BPM,
  type WorkoutInput,
  type WorkoutRecommendation,
} from "@/lib/coach/recommender";
import { GOALS } from "@/lib/training/goals";
import type { ProgressionSnapshot } from "@/lib/training/progression";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** `days` whole calendar days after `base`, at local midnight. */
function addDays(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

// The recommender is parameterised on the race date (issue #99), so no anchor
// below hardcodes a calendar date — each is derived from the race under test
// via the engine's own phase blocks. The whole suite runs against two races:
// the 2026 default (proving the demo plan is unchanged) and an arbitrary 2027
// race (proving date-independence).
const RACE_DATES: [string, Date][] = [
  ["2026 default race", new Date(2026, 8, 20)],
  ["2027 race", new Date(2027, 9, 10)],
];

describe.each(RACE_DATES)("recommendWorkout — %s", (_label, RACE) => {
  const phases = buildPhases(RACE);

  /** First date with the given JS weekday (0 = Sun) inside a phase, at 08:00. */
  function anchor(phase: PhaseKey, jsWeekday: number): Date {
    let d = phases[phase].startDate;
    while (d.getDay() !== jsWeekday) d = addDays(d, 1);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0);
  }

  // Anchor dates chosen so the weekday matches the plan slot under test.
  const BURN_WEDNESDAY = anchor("burn", 3); // burn, easy day
  const BURN_MONDAY = anchor("burn", 1); // burn, easy day
  const BURN_TUESDAY = anchor("burn", 2); // burn, rest day
  const ADAPT_WEDNESDAY = anchor("adapt", 3); // adapt, easy day
  const SHARPEN_WEDNESDAY = anchor("sharpen", 3); // sharpen, tempo day
  const PEAK_SUNDAY = anchor("peak", 0); // peak, long-run day

  /** Progression snapshot with a full window and optimal load; override per test. */
  function snapshot(overrides: Partial<ProgressionSnapshot> = {}): ProgressionSnapshot {
    return {
      date: BURN_WEDNESDAY,
      hasFullWindow: true,
      paceEfficiency: 4.2,
      hrStability: 85,
      trainingLoad: { acute: 30, chronic: 30, ratio: 1.0, risk: "optimal" },
      zone2Percent: 90,
      volumeKm: 120,
      readyToIncrease: false,
      ...overrides,
    };
  }

  /** A fully recovered input anchored to `now`; override only what a test needs. */
  function input(now: Date, overrides: Partial<WorkoutInput> = {}): WorkoutInput {
    return {
      userId: "user-1",
      goal: GOALS.zone2,
      progression: snapshot(),
      lastRun: new Date(now.getTime() - 3 * DAY_MS),
      footballYesterday: false,
      raceDate: RACE,
      ...overrides,
    };
  }

  function recommend(
    overrides: Partial<WorkoutInput> = {},
    now: Date = BURN_WEDNESDAY
  ): WorkoutRecommendation {
    return recommendWorkout(input(now, overrides), now);
  }

  describe("step 2 — recovery buffer (24 h easy / 48 h tempo)", () => {
    it("recommends rest when an easy day comes under 24 h after the last run", () => {
      const rec = recommend({ lastRun: new Date(BURN_WEDNESDAY.getTime() - 12 * HOUR_MS) });
      expect(rec.type).toBe("rest");
      expect(rec.distanceKm).toBe(0);
    });

    it("explains the recovery buffer in the reason list", () => {
      const rec = recommend({ lastRun: new Date(BURN_WEDNESDAY.getTime() - 12 * HOUR_MS) });
      expect(rec.reason.join(" ")).toMatch(/24/);
    });

    it("allows an easy run at exactly 24 h", () => {
      const rec = recommend({ lastRun: new Date(BURN_WEDNESDAY.getTime() - 24 * HOUR_MS) });
      expect(rec.type).not.toBe("rest");
    });

    it("recommends rest when the tempo day comes under 48 h after the last run", () => {
      const rec = recommend(
        { lastRun: new Date(SHARPEN_WEDNESDAY.getTime() - 24 * HOUR_MS) },
        SHARPEN_WEDNESDAY
      );
      expect(rec.type).toBe("rest");
      expect(rec.reason.join(" ")).toMatch(/48/);
    });

    it("allows the tempo session at exactly 48 h", () => {
      const rec = recommend(
        { lastRun: new Date(SHARPEN_WEDNESDAY.getTime() - 48 * HOUR_MS) },
        SHARPEN_WEDNESDAY
      );
      expect(rec.type).toBe("tempo");
    });
  });

  describe("step 3 — football recovery", () => {
    it("downgrades a tempo day to easy the day after a match", () => {
      const rec = recommend(
        { footballYesterday: true, progression: snapshot({ date: SHARPEN_WEDNESDAY }) },
        SHARPEN_WEDNESDAY
      );
      expect(rec.type).toBe("easy");
      expect(rec.reason.join(" ")).toMatch(/fodbold/i);
    });

    it("does not affect an easy day", () => {
      const rec = recommend({ footballYesterday: true });
      expect(rec.type).toBe("easy");
    });
  });

  describe("step 4 — distance from phase", () => {
    it("stays within the adapt band (6–8 km)", () => {
      const rec = recommend({ progression: snapshot({ date: ADAPT_WEDNESDAY }) }, ADAPT_WEDNESDAY);
      expect(rec.distanceKm).toBeGreaterThanOrEqual(6);
      expect(rec.distanceKm).toBeLessThanOrEqual(8);
    });

    it("stays within the burn band (8–10 km)", () => {
      const rec = recommend();
      expect(rec.distanceKm).toBeGreaterThanOrEqual(8);
      expect(rec.distanceKm).toBeLessThanOrEqual(10);
    });

    it("starts at the phase minimum when progression says hold", () => {
      const rec = recommend({ progression: snapshot({ readyToIncrease: false }) });
      expect(rec.distanceKm).toBe(getPhaseRules("burn", RACE).minDistanceKm);
    });
  });

  describe("step 5 — progression unlocks the upper distance", () => {
    it("moves to the phase maximum when ready to increase", () => {
      const rec = recommend({ progression: snapshot({ readyToIncrease: true }) });
      expect(rec.distanceKm).toBe(getPhaseRules("burn", RACE).maxDistanceKm);
    });

    it("holds the minimum when pace efficiency is unknown", () => {
      const rec = recommend({
        progression: snapshot({ readyToIncrease: true, paceEfficiency: null }),
      });
      expect(rec.distanceKm).toBe(getPhaseRules("burn", RACE).minDistanceKm);
    });
  });

  describe("step 6 — intensity per phase", () => {
    it("never schedules tempo in a base phase, even on the mid-week slot", () => {
      const rec = recommend();
      expect(rec.type).toBe("easy");
    });

    it("schedules the mid-week tempo in sharpen", () => {
      const rec = recommend(
        { progression: snapshot({ date: SHARPEN_WEDNESDAY }) },
        SHARPEN_WEDNESDAY
      );
      expect(rec.type).toBe("tempo");
    });

    it("schedules the Sunday long run in peak", () => {
      const rec = recommend({ progression: snapshot({ date: PEAK_SUNDAY }) }, PEAK_SUNDAY);
      expect(rec.type).toBe("long");
      expect(rec.distanceKm).toBeLessThanOrEqual(getPhaseRules("peak", RACE).longRunMaxKm);
    });

    it("caps easy runs at the Zone 2 ceiling (155 bpm)", () => {
      const rec = recommend();
      expect(rec.heartRateCap).toBe(155);
    });

    it("gives tempo a higher heart-rate cap", () => {
      const rec = recommend(
        { progression: snapshot({ date: SHARPEN_WEDNESDAY }) },
        SHARPEN_WEDNESDAY
      );
      expect(rec.heartRateCap).toBe(TEMPO_HR_CAP_BPM);
    });
  });

  describe("step 7 — shoe selection", () => {
    it("puts the Vomero on easy days", () => {
      expect(recommend().shoe).toBe("vomero");
    });

    it("puts the Vomero on long runs", () => {
      const rec = recommend({ progression: snapshot({ date: PEAK_SUNDAY }) }, PEAK_SUNDAY);
      expect(rec.shoe).toBe("vomero");
    });

    it("puts the Adios Pro 4 on tempo days only", () => {
      const rec = recommend(
        { progression: snapshot({ date: SHARPEN_WEDNESDAY }) },
        SHARPEN_WEDNESDAY
      );
      expect(rec.shoe).toBe("adios-pro-4");
    });
  });

  describe("step 8 — workout card output", () => {
    it("always carries at least one reason", () => {
      expect(recommend().reason.length).toBeGreaterThan(0);
      expect(
        recommend({ lastRun: new Date(BURN_WEDNESDAY.getTime() - HOUR_MS) }).reason.length
      ).toBeGreaterThan(0);
    });

    it("returns a full Mon–Sun week strip matching the phase plan", () => {
      const rec = recommend();
      expect(rec.weekStrip).toHaveLength(7);
      expect(rec.weekStrip.map((d) => d.weekday)).toEqual([
        "mon",
        "tue",
        "wed",
        "thu",
        "fri",
        "sat",
        "sun",
      ]);
    });

    it("formats the pace range as m:ss strings", () => {
      const rec = recommend();
      expect(rec.paceRange.min).toMatch(/^\d:\d{2}$/);
      expect(rec.paceRange.max).toMatch(/^\d:\d{2}$/);
    });
  });

  describe("plan rest days", () => {
    it("recommends rest on a scheduled rest day even when recovered", () => {
      const rec = recommend({ progression: snapshot({ date: BURN_TUESDAY }) }, BURN_TUESDAY);
      expect(rec.type).toBe("rest");
    });

    it("recommends the plan's easy run on a Monday run day", () => {
      const rec = recommend({ progression: snapshot({ date: BURN_MONDAY }) }, BURN_MONDAY);
      expect(rec.type).toBe("easy");
    });
  });

  describe("edge case — first runs (no full history window)", () => {
    it("clamps the distance to the adapt minimum", () => {
      const rec = recommend({
        progression: snapshot({
          hasFullWindow: false,
          paceEfficiency: null,
          volumeKm: null,
          readyToIncrease: null,
        }),
      });
      expect(rec.distanceKm).toBe(getPhaseRules("adapt", RACE).minDistanceKm);
      expect(rec.reason.join(" ")).toMatch(/historik|første/i);
    });
  });

  describe("edge case — 14+ day pause", () => {
    it("cuts the distance by 20% after a long pause", () => {
      const paused = recommend({ lastRun: new Date(BURN_WEDNESDAY.getTime() - 15 * DAY_MS) });
      const active = recommend({ lastRun: new Date(BURN_WEDNESDAY.getTime() - 3 * DAY_MS) });
      expect(paused.distanceKm).toBeCloseTo(active.distanceKm * 0.8, 5);
      expect(paused.reason.join(" ")).toMatch(/pause/i);
    });

    it("does not cut the distance at 13 days", () => {
      const rec = recommend({ lastRun: new Date(BURN_WEDNESDAY.getTime() - 13 * DAY_MS) });
      expect(rec.distanceKm).toBe(getPhaseRules("burn", RACE).minDistanceKm);
    });
  });

  describe("edge case — injury history", () => {
    it("extends the recovery buffer to 72 h", () => {
      const rec = recommend({
        injuryHistory: true,
        lastRun: new Date(BURN_WEDNESDAY.getTime() - 60 * HOUR_MS),
      });
      expect(rec.type).toBe("rest");
      expect(rec.reason.join(" ")).toMatch(/skade/i);
    });

    it("allows a run once 72 h have passed", () => {
      const rec = recommend({
        injuryHistory: true,
        lastRun: new Date(BURN_WEDNESDAY.getTime() - 73 * HOUR_MS),
      });
      expect(rec.type).not.toBe("rest");
    });
  });
});
