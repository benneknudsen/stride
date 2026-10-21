import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoachActivityInput } from "@/lib/coach/dashboard";
import {
  ALL_CONSTRAINTS,
  buildPhases,
  getPhaseRules,
  getWeekPlan,
  type PhaseKey,
  type WorkoutContext,
} from "@/lib/coach/engine";
import { buildNextActivity } from "@/lib/coach/next-activity";
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

afterEach(() => {
  vi.restoreAllMocks();
});

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
  const TAPER_TUESDAY = anchor("taper", 2); // taper, planned rest day

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

  describe("step 3b — readiness band language (#245)", () => {
    /** Snapshot on `date` with the given acute:chronic ratio. */
    function atRatio(ratio: number, date: Date): ProgressionSnapshot {
      return snapshot({ date, trainingLoad: { acute: 30, chronic: 30, ratio, risk: "optimal" } });
    }

    it("stays positive and never says 'risiko' at ratio 1.29 (gauge reads 88% ready)", () => {
      const rec = recommend({ progression: atRatio(1.29, BURN_WEDNESDAY) });
      expect(rec.type).not.toBe("rest");
      const text = rec.reason.join(" ");
      expect(text).toMatch(/readiness/i);
      expect(text).toMatch(/klar/i);
      expect(text).not.toMatch(/risiko/i);
    });

    it("reads a rested athlete (ratio < 0.8) as ready, not a rest warning", () => {
      const rec = recommend({ progression: atRatio(0.7, BURN_WEDNESDAY) });
      expect(rec.type).not.toBe("rest");
      const text = rec.reason.join(" ");
      expect(text).toMatch(/klar/i);
      expect(text).not.toMatch(/risiko/i);
    });

    it("downgrades a tempo day to easy in the easy band (ratio 1.5)", () => {
      const rec = recommend({ progression: atRatio(1.5, SHARPEN_WEDNESDAY) }, SHARPEN_WEDNESDAY);
      expect(rec.type).toBe("easy");
      expect(rec.reason.join(" ")).toMatch(/rolig tur/i);
    });

    it("recommends rest in the rest band (ratio 2.0), not a run", () => {
      const rec = recommend({ progression: atRatio(2.0, BURN_WEDNESDAY) });
      expect(rec.type).toBe("rest");
      expect(rec.distanceKm).toBe(0);
      expect(rec.reason.join(" ")).toMatch(/restitution/i);
    });

    it("keeps the recovery buffer independent of readiness — fresh but too soon still rests", () => {
      const rec = recommend({
        progression: atRatio(1.0, BURN_WEDNESDAY),
        lastRun: new Date(BURN_WEDNESDAY.getTime() - 12 * HOUR_MS),
      });
      expect(rec.type).toBe("rest");
      expect(rec.reason.join(" ")).toMatch(/24/);
    });

    it("keeps the readiness reason on a run card, before the distance reason (#332)", () => {
      const rec = recommend({ progression: atRatio(1.0, BURN_WEDNESDAY) });

      expect(rec.type).toBe("easy");
      const readinessIndex = rec.reason.findIndex((line) => /readiness/i.test(line));
      const distanceIndex = rec.reason.findIndex((line) => /Distance fra/i.test(line));
      expect(readinessIndex).toBeGreaterThanOrEqual(0);
      expect(distanceIndex).toBeGreaterThan(readinessIndex);
    });
  });

  describe("step 3a — load-risk guard (#330)", () => {
    /** A snapshot whose risk field is the one the dashboard publishes. */
    function atRisk(ratio: number, risk: ProgressionSnapshot["trainingLoad"]["risk"], date: Date) {
      return snapshot({ date, trainingLoad: { acute: 30 * ratio, chronic: 30, ratio, risk } });
    }

    it("rests on high load risk even when the recovery buffer is clear", () => {
      const friday = anchor("sharpen", 5);
      const now = new Date(friday.getFullYear(), friday.getMonth(), friday.getDate(), 23, 0);
      const rec = recommend(
        {
          progression: atRisk(1.6, "high", now),
          lastRun: new Date(now.getTime() - 29 * HOUR_MS),
        },
        now
      );

      expect(rec.type).toBe("rest");
      expect(rec.distanceKm).toBe(0);
      expect(rec.reason.join(" ")).toMatch(/skadesrisiko/i);
      expect(rec.reason.join(" ")).toMatch(/restitution/i);
    });

    it("keeps the high-risk reason when the recovery buffer also rests", () => {
      const friday = anchor("sharpen", 5);
      const now = new Date(friday.getFullYear(), friday.getMonth(), friday.getDate(), 23, 0);
      const rec = recommend(
        {
          progression: atRisk(1.6, "high", now),
          lastRun: new Date(now.getTime() - 5 * HOUR_MS),
        },
        now
      );

      expect(rec.type).toBe("rest");
      expect(rec.reason.join(" ")).toMatch(/skadesrisiko/i);
      expect(rec.reason.join(" ")).toMatch(/24/);
    });

    it("does not block at elevated risk but downgrades a tempo day to easy", () => {
      const rec = recommend(
        { progression: atRisk(1.45, "elevated", SHARPEN_WEDNESDAY) },
        SHARPEN_WEDNESDAY
      );

      expect(rec.type).toBe("easy");
      expect(rec.reason.join(" ")).toMatch(/forhøjet/i);
      expect(rec.reason.join(" ")).toMatch(/rolig/i);
    });

    it("keeps an easy day easy at elevated risk — the guard only softens hard passes", () => {
      const rec = recommend(
        { progression: atRisk(1.45, "elevated", BURN_WEDNESDAY) },
        BURN_WEDNESDAY
      );

      expect(rec.type).toBe("easy");
      expect(rec.reason.join(" ")).not.toMatch(/skadesrisiko/i);
    });

    it("leaves the planned slot untouched at optimal risk — the ratio 1.0 regression guard", () => {
      const rec = recommend(
        { progression: atRisk(1.0, "optimal", SHARPEN_WEDNESDAY) },
        SHARPEN_WEDNESDAY
      );

      expect(rec.type).toBe("tempo");
    });
  });

  describe("step 3c — week-to-date load (#256)", () => {
    /**
     * The exact budget the gate measures against on `now`: the phase week's
     * intended total, prorated by how far into the week we are (#261) so a
     * transition week's mixed volumes don't rest the athlete out of Thu–Sun.
     */
    function intendedWeekKm(phase: PhaseKey, now: Date): number {
      const dayOfWeek = (now.getDay() + 6) % 7;
      const monday = addDays(now, -dayOfWeek);
      const total = getWeekPlan(phase, monday, RACE).reduce(
        (sum, d) => sum + (d.distanceKm ?? 0),
        0
      );
      return total * Math.min(1, (dayOfWeek + 1) / 7);
    }

    it("closes the week's gap when the tally shows the week is behind (#333)", () => {
      // #333: a known tally that leaves the week well behind its prorated goal
      // now raises the distance instead of behaving as if the week were unread.
      const withTally = recommend({ weekToDateKm: 5 });
      expect(withTally.distanceKm).toBeGreaterThan(recommend().distanceKm);
      expect(withTally.reason.join(" ")).toMatch(/bag ugens planlagte volumen/i);
    });

    it("drops the week-gap line when the raised distance is scaled back down", () => {
      // Repair R6.1: a tally just short of the budget rounds the target half a
      // kilometre past it, so the scale-down gate cuts the run to the phase
      // minimum. The card must not still claim today's run is longer.
      const budget = intendedWeekKm("burn", BURN_WEDNESDAY);
      const rec = recommend({ weekToDateKm: budget - 9.96 });

      expect(rec.distanceKm).toBe(getPhaseRules("burn", RACE).minDistanceKm);
      expect(rec.reason.join(" ")).toMatch(/næsten brugt/i);
      expect(rec.reason.join(" ")).not.toMatch(/bag ugens planlagte volumen/i);
    });

    it("keeps the tempo day hard when the week is barely started", () => {
      const rec = recommend(
        { progression: snapshot({ date: SHARPEN_WEDNESDAY }), weekToDateKm: 6 },
        SHARPEN_WEDNESDAY
      );
      expect(rec.type).toBe("tempo");
    });

    it("downgrades a tempo day to easy when the week is nearly at its volume", () => {
      const budget = intendedWeekKm("sharpen", SHARPEN_WEDNESDAY);
      const rec = recommend(
        { progression: snapshot({ date: SHARPEN_WEDNESDAY }), weekToDateKm: budget - 2 },
        SHARPEN_WEDNESDAY
      );
      expect(rec.type).toBe("easy");
      expect(rec.shoe).toBe("vomero");
      expect(rec.reason.join(" ")).toMatch(/uge/i);
    });

    it("downgrades the long run to easy on a loaded week", () => {
      const budget = intendedWeekKm("peak", PEAK_SUNDAY);
      const rec = recommend(
        { progression: snapshot({ date: PEAK_SUNDAY }), weekToDateKm: budget - 12 },
        PEAK_SUNDAY
      );
      expect(rec.type).toBe("easy");
      expect(rec.reason.join(" ")).toMatch(/uge/i);
    });

    it("recommends rest once the week has reached its intended volume", () => {
      const rec = recommend({ weekToDateKm: intendedWeekKm("burn", BURN_WEDNESDAY) });
      expect(rec.type).toBe("rest");
      expect(rec.distanceKm).toBe(0);
      expect(rec.reason.join(" ")).toMatch(/uge/i);
    });

    it("does not keep the ready-band run line on the budget rest card (#332)", () => {
      const rec = recommend({ weekToDateKm: intendedWeekKm("burn", BURN_WEDNESDAY) });

      expect(rec.type).toBe("rest");
      expect(rec.reason.join(" ")).not.toMatch(/klar til dagens pas/i);
    });

    it("does not keep the easy-band run line on the budget rest card (#332)", () => {
      const rec = recommend({
        progression: snapshot({
          trainingLoad: { acute: 45, chronic: 30, ratio: 1.5, risk: "optimal" },
        }),
        weekToDateKm: intendedWeekKm("burn", BURN_WEDNESDAY),
      });

      expect(rec.type).toBe("rest");
      expect(rec.reason.join(" ")).not.toMatch(/overvej en rolig tur/i);
    });

    it("shortens the run to the phase minimum when today would blow past the budget", () => {
      // #336: the unlock needs the measured week-over-week comparison too, so
      // the "fresh" baseline carries one — otherwise this test would measure
      // the missing comparison instead of the week budget.
      const progression = snapshot({ readyToIncrease: true });
      const fresh = recommend({
        progression,
        paceEfficiencyTrend: { current: 4.2, previous: 4.2 },
      });
      expect(fresh.distanceKm).toBe(getPhaseRules("burn", RACE).maxDistanceKm);

      const loaded = recommend({
        progression,
        weekToDateKm: intendedWeekKm("burn", BURN_WEDNESDAY) - 5,
      });
      expect(loaded.distanceKm).toBe(getPhaseRules("burn", RACE).minDistanceKm);
      expect(loaded.reason.join(" ")).toMatch(/uge/i);
    });

    it("prorates the budget to the elapsed week, so Monday cannot spend all of it (#261)", () => {
      // Half the week's plan, run by Monday: under the full-week total, but far
      // over Monday's 1/7 share — the un-prorated gate waved this through.
      const fullWeekKm = intendedWeekKm("burn", BURN_MONDAY) * 7;
      const rec = recommend({ weekToDateKm: fullWeekKm * 0.5 }, BURN_MONDAY);
      expect(rec.type).toBe("rest");
      expect(rec.reason.join(" ")).toMatch(/uge/i);
    });

    it("keeps the recovery buffer ahead of the week-load gate", () => {
      const rec = recommend({
        lastRun: new Date(BURN_WEDNESDAY.getTime() - 12 * HOUR_MS),
        weekToDateKm: intendedWeekKm("burn", BURN_WEDNESDAY),
      });
      expect(rec.type).toBe("rest");
      expect(rec.reason.join(" ")).toMatch(/24/);
    });

    it("keeps the readiness rest band ahead of the week-load gate", () => {
      const rec = recommend({
        progression: snapshot({
          trainingLoad: { acute: 60, chronic: 30, ratio: 2.0, risk: "high" },
        }),
        weekToDateKm: intendedWeekKm("burn", BURN_WEDNESDAY),
      });
      expect(rec.type).toBe("rest");
      expect(rec.reason.join(" ")).toMatch(/restitution/i);
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
    it("moves to the phase maximum when ready to increase and pace efficiency held", () => {
      // #336: the unlock no longer rides on "there is a pace-efficiency number"
      // — it needs the week-over-week comparison the dashboard measures off
      // the same snapshot series the pace-trend chart plots. Same expectation as
      // before the fix, but the card now has to earn it.
      const rec = recommend({
        progression: snapshot({ readyToIncrease: true }),
        paceEfficiencyTrend: { current: 4.2, previous: 4.2 },
      });
      expect(rec.distanceKm).toBe(getPhaseRules("burn", RACE).maxDistanceKm);
    });

    it("holds the minimum when pace efficiency is unknown", () => {
      const rec = recommend({
        progression: snapshot({ readyToIncrease: true, paceEfficiency: null }),
      });
      expect(rec.distanceKm).toBe(getPhaseRules("burn", RACE).minDistanceKm);
    });
  });

  describe("step 5 — pace efficiency must be measured, not assumed (#336)", () => {
    /** The burn phase's upper distance — the one the unlock hands out. */
    const burnMax = (): number => getPhaseRules("burn", RACE).maxDistanceKm;
    /** The burn phase's minimum — what a locked upper distance falls back to. */
    const burnMin = (): number => getPhaseRules("burn", RACE).minDistanceKm;

    it("unlocks the upper distance when pace efficiency improved week over week", () => {
      const rec = recommend({
        progression: snapshot({ readyToIncrease: true }),
        paceEfficiencyTrend: { current: 4.3, previous: 4.1 },
      });

      expect(rec.distanceKm).toBe(burnMax());
      // The reason must name what was compared — "data er stabil" is not a
      // measurement, the two numbers are.
      expect(rec.reason.join(" ")).toMatch(/ikke faldet siden sidste uge/i);
      expect(rec.reason.join(" ")).toContain("4,3 mod 4,1");
    });

    it("unlocks the upper distance when pace efficiency held week over week", () => {
      const rec = recommend({
        progression: snapshot({ readyToIncrease: true }),
        paceEfficiencyTrend: { current: 4.2, previous: 4.2 },
      });

      expect(rec.distanceKm).toBe(burnMax());
      expect(rec.reason.join(" ")).toMatch(/ikke faldet siden sidste uge/i);
    });

    it("holds the phase minimum when pace efficiency fell week over week", () => {
      // The regression #336 exists for: the number existed, so the old code
      // handed out the upper distance and called the data stable — while the
      // efficiency had actually dropped.
      const rec = recommend({
        progression: snapshot({ readyToIncrease: true }),
        paceEfficiencyTrend: { current: 4.1, previous: 4.3 },
      });

      expect(rec.distanceKm).toBe(burnMin());
      expect(rec.reason.join(" ")).not.toMatch(/stabil/i);
      expect(rec.reason.join(" ")).toMatch(/faldet siden sidste uge/i);
      expect(rec.reason.join(" ")).toContain("4,1 mod 4,3");
    });

    it("holds the phase minimum when there is not enough history to compare", () => {
      // "Vi ved det ikke" is not "det er stabilt": without the comparison the
      // upper distance stays locked.
      const rec = recommend({ progression: snapshot({ readyToIncrease: true }) });

      expect(rec.distanceKm).toBe(burnMin());
      expect(rec.reason.join(" ")).not.toMatch(/stabil/i);
    });

    it("keeps the phase minimum when the load is not optimal, whatever the trend says", () => {
      const rec = recommend({
        progression: snapshot({ readyToIncrease: false }),
        paceEfficiencyTrend: { current: 4.3, previous: 4.1 },
      });

      expect(rec.distanceKm).toBe(burnMin());
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

    it("carries no week plan — no surface renders a Mon–Sun strip (issue #291)", () => {
      // The recommender still reads the phase week plan for today's slot and the
      // week's budget, but it no longer hands the plan on. Pinned by shape so a
      // week strip can't quietly come back.
      expect(Object.keys(recommend()).sort()).toEqual([
        "distanceKm",
        "heartRateCap",
        "paceRange",
        "reason",
        "recoveryHours",
        "shoe",
        "trace",
        "type",
      ]);
    });

    it("still takes today's slot from the phase week plan, not from thin air", () => {
      // The plan is load-bearing even though it no longer escapes: a Wednesday in
      // the sharpen block is a tempo day, and a Tuesday in burn is the plan's
      // rest slot — a preference the state may turn into the phase's easy run
      // (#332), but the slot still comes from the plan.
      const sharpen = recommend(
        { progression: snapshot({ date: SHARPEN_WEDNESDAY }) },
        SHARPEN_WEDNESDAY
      );
      expect(sharpen.type).toBe("tempo");
      const burn = recommend({ progression: snapshot({ date: BURN_TUESDAY }) }, BURN_TUESDAY);
      expect(burn.type).toBe("easy");
      expect(burn.reason.join(" ")).toMatch(/præference/i);
    });

    it("formats the pace range as m:ss strings", () => {
      const rec = recommend();
      expect(rec.paceRange.min).toMatch(/^\d:\d{2}$/);
      expect(rec.paceRange.max).toMatch(/^\d:\d{2}$/);
    });
  });

  describe("step 8b — constraint trace (#301)", () => {
    it("carries one trace row per constraint, in the engine's order", () => {
      expect(recommend().trace.map((t) => t.id)).toEqual(ALL_CONSTRAINTS.map((c) => c.id));
    });

    it("traces the phase the card was built in", () => {
      const burn = recommend().trace;
      expect(burn.find((t) => t.id === "zone2-hr-ceiling")?.status).not.toBe("not-applicable");

      const sharpen = recommend(
        { progression: snapshot({ date: SHARPEN_WEDNESDAY }) },
        SHARPEN_WEDNESDAY
      ).trace;
      expect(sharpen.find((t) => t.id === "zone2-hr-ceiling")?.status).toBe("not-applicable");
    });

    it("shows no blocked rule and no empty detail on a clean recommendation", () => {
      const clean = recommend();
      expect(clean.trace.filter((t) => t.status === "blocked")).toEqual([]);
      expect(clean.trace.every((t) => t.detail.length > 0)).toBe(true);
    });

    it("is deterministic — same input and clock give an identical trace", () => {
      expect(JSON.stringify(recommend().trace)).toBe(JSON.stringify(recommend().trace));
    });

    it("carries no rule trace on an early rest card — the reasons explain it", () => {
      const rest = recommend({ lastRun: new Date(BURN_WEDNESDAY.getTime() - 12 * HOUR_MS) });
      expect(rest.type).toBe("rest");
      expect(rest.trace).toEqual([]);
    });

    it("shows the hard rule as blocked and downgrades the card to a rolig tur", () => {
      // The B3 downgrade is a defensive net the real inputs cannot trip (the
      // recommendation is built from the same rules it is validated against), so
      // fault-inject one hard issue into the rule and prove both halves move
      // together: the card downgrades, the trace names the rule that did it.
      const recovery = ALL_CONSTRAINTS.find((c) => c.id === "recovery-window");
      if (!recovery) throw new Error("recovery-window constraint missing");
      vi.spyOn(recovery, "evaluate").mockReturnValue({
        constraintId: "recovery-window",
        severity: "hard",
        message: "Testblokering.",
        suggestion: "Testforslag.",
      });

      const rec = recommend(
        { progression: snapshot({ date: SHARPEN_WEDNESDAY }) },
        SHARPEN_WEDNESDAY
      );

      expect(rec.type).toBe("easy");
      expect(rec.reason.join(" ")).toContain("recovery-window");
      const entry = rec.trace.find((t) => t.id === "recovery-window");
      expect(entry?.status).toBe("blocked");
    });
  });

  describe("plan rest days — a preference, not a command (#332)", () => {
    it("turns a scheduled rest day into the phase's easy run when the state allows it", () => {
      // Recovered (3 days since the last run), readiness "ready", no week volume
      // reported: nothing but the calendar says rest, so the state decides.
      const rec = recommend({ progression: snapshot({ date: BURN_TUESDAY }) }, BURN_TUESDAY);

      expect(rec.type).toBe("easy");
      expect(rec.distanceKm).toBe(getPhaseRules("burn", RACE).minDistanceKm);
      expect(rec.reason.join(" ")).toMatch(/præference/i);
      expect(rec.reason.join(" ")).not.toMatch(/Planlagt hviledag/);
    });

    it("still rests on a rest slot when the recovery buffer is broken", () => {
      const rec = recommend(
        {
          progression: snapshot({ date: BURN_TUESDAY }),
          lastRun: new Date(BURN_TUESDAY.getTime() - 12 * HOUR_MS),
        },
        BURN_TUESDAY
      );

      expect(rec.type).toBe("rest");
      expect(rec.distanceKm).toBe(0);
      expect(rec.reason.join(" ")).toMatch(/24/);
    });

    it("still rests on a rest slot when readiness is in the rest band", () => {
      const rec = recommend(
        {
          progression: snapshot({
            date: BURN_TUESDAY,
            trainingLoad: { acute: 60, chronic: 30, ratio: 2.0, risk: "optimal" },
          }),
        },
        BURN_TUESDAY
      );

      expect(rec.type).toBe("rest");
      expect(rec.reason.join(" ")).toMatch(/restitution/i);
    });

    it("still rests on a rest slot when the load risk is high (#330)", () => {
      const rec = recommend(
        {
          progression: snapshot({
            date: BURN_TUESDAY,
            trainingLoad: { acute: 48, chronic: 30, ratio: 1.6, risk: "high" },
          }),
        },
        BURN_TUESDAY
      );

      expect(rec.type).toBe("rest");
      expect(rec.distanceKm).toBe(0);
      expect(rec.reason.join(" ")).toMatch(/skadesrisiko/i);
    });

    it("still rests on a rest slot when the week's volume budget is spent", () => {
      const rec = recommend(
        { progression: snapshot({ date: BURN_TUESDAY }), weekToDateKm: 999 },
        BURN_TUESDAY
      );

      expect(rec.type).toBe("rest");
      expect(rec.reason.join(" ")).toMatch(/uge/i);
    });

    it("names the gate, never the calendar, on a rest day (#332)", () => {
      // The buffer is the gate that rests this rest-slot day: the reason line
      // must say so, and the calendar line must be gone.
      const rec = recommend(
        {
          progression: snapshot({ date: BURN_TUESDAY }),
          lastRun: new Date(BURN_TUESDAY.getTime() - 4 * HOUR_MS),
        },
        BURN_TUESDAY
      );

      expect(rec.type).toBe("rest");
      const text = rec.reason.join(" ");
      expect(text).toMatch(/restitutionsbuffer/i);
      expect(text).not.toMatch(/Planlagt hviledag/);
    });

    it("is deterministic — same input and clock give the same card", () => {
      const first = recommend({ progression: snapshot({ date: BURN_TUESDAY }) }, BURN_TUESDAY);
      const second = recommend({ progression: snapshot({ date: BURN_TUESDAY }) }, BURN_TUESDAY);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it("still rests on the taper's planned rest days — the race week is deliberate", () => {
      const rec = recommend({ progression: snapshot({ date: TAPER_TUESDAY }) }, TAPER_TUESDAY);

      expect(rec.type).toBe("rest");
      expect(rec.reason.join(" ")).toMatch(/taper/i);
    });

    it("recommends the plan's easy run on a Monday run day", () => {
      const rec = recommend({ progression: snapshot({ date: BURN_MONDAY }) }, BURN_MONDAY);
      expect(rec.type).toBe("easy");
    });
  });

  describe("#333 — the day follows the runner's state, not only the calendar", () => {
    /** The week's intended volume, prorated to the day under test. */
    function intendedWeekKm(phase: PhaseKey, now: Date): number {
      const dayOfWeek = (now.getDay() + 6) % 7;
      const monday = addDays(now, -dayOfWeek);
      const total = getWeekPlan(phase, monday, RACE).reduce(
        (sum, day) => sum + (day.distanceKm ?? 0),
        0
      );
      return total * Math.min(1, (dayOfWeek + 1) / 7);
    }

    /** The last run's shape, classified by the shared run-character module. */
    function summary(
      character: "easy" | "tempo" | "long" | "hard",
      distanceKm = 8
    ): NonNullable<WorkoutInput["lastRunSummary"]> {
      return { distanceKm, movingTimeSec: 2_700, character };
    }

    it("AC3: a 6-day pause restarts with a rolig tur and names the pause", () => {
      const rec = recommend(
        {
          progression: snapshot({ date: SHARPEN_WEDNESDAY }),
          lastRun: new Date(SHARPEN_WEDNESDAY.getTime() - 6 * DAY_MS),
          lastRunSummary: summary("easy"),
        },
        SHARPEN_WEDNESDAY
      );

      expect(rec.type).not.toBe("rest");
      expect(rec.type).toBe("easy");
      expect(rec.reason.join(" ")).toMatch(/pause i 6 dage/i);
    });

    it("AC2: without lastRunSummary a 4-day gap leaves the tempo day unchanged", () => {
      const rec = recommend(
        {
          progression: snapshot({ date: SHARPEN_WEDNESDAY }),
          lastRun: new Date(SHARPEN_WEDNESDAY.getTime() - 4 * DAY_MS),
        },
        SHARPEN_WEDNESDAY
      );

      expect(rec.type).toBe("tempo");
    });

    it("AC2: with lastRunSummary a 4-day pause turns the tempo day easy", () => {
      const rec = recommend(
        {
          progression: snapshot({ date: SHARPEN_WEDNESDAY }),
          lastRun: new Date(SHARPEN_WEDNESDAY.getTime() - 4 * DAY_MS),
          lastRunSummary: summary("easy"),
        },
        SHARPEN_WEDNESDAY
      );

      expect(rec.type).toBe("easy");
      expect(rec.reason.join(" ")).toMatch(/pause i 4 dage/i);
    });

    it("AC2: a 14+ day break writes only the long-pause line, never both pauses", () => {
      // Two pause concepts meet here: the 3-day state gate and the 14-day
      // restart scale-down. On a long break the 14-day line already says the
      // day restarted easy, so the card must not repeat "pause i 15 dage".
      const rec = recommend(
        {
          lastRun: new Date(BURN_WEDNESDAY.getTime() - 15 * DAY_MS),
          lastRunSummary: summary("easy"),
        },
        BURN_WEDNESDAY
      );

      const pauseLines = rec.reason.filter((line) => /pause/i.test(line));
      expect(pauseLines).toHaveLength(1);
      expect(pauseLines[0]).toContain("14+");
    });

    it("AC4: same readiness, different last-run character gives different days", () => {
      // Repair R1: Z3 tempo is ordinary aerobic work and no longer gates. The
      // contrast must come from a Z4–Z5 run, the effort that actually leaves
      // 48 h of residue. A long day keeps its 24 h buffer, so a hard run 30 h
      // ago clears the buffer and the character gate is what softens the day.
      const lastRun = new Date(PEAK_SUNDAY.getTime() - 30 * HOUR_MS);
      const afterEasy = recommend(
        {
          progression: snapshot({ date: PEAK_SUNDAY }),
          lastRun,
          lastRunSummary: summary("easy"),
        },
        PEAK_SUNDAY
      );
      const afterHard = recommend(
        {
          progression: snapshot({ date: PEAK_SUNDAY }),
          lastRun,
          lastRunSummary: summary("hard"),
        },
        PEAK_SUNDAY
      );

      expect(afterEasy.type).toBe("long");
      expect(afterHard.type).toBe("easy");
      expect(afterHard.reason.join(" ")).toMatch(/hårdt pas/i);
    });

    it("AC4: a Z3 last run does not cancel the plan's tempo day", () => {
      // Repair R1: the old quality-last gate read Z3 as quality and deleted the
      // tempo slot. Z3 is tempo work, not the kind of session that owes 48 h.
      const rec = recommend(
        {
          progression: snapshot({ date: SHARPEN_WEDNESDAY }),
          lastRun: new Date(SHARPEN_WEDNESDAY.getTime() - 60 * HOUR_MS),
          lastRunSummary: summary("tempo"),
        },
        SHARPEN_WEDNESDAY
      );

      expect(rec.type).toBe("tempo");
      expect(rec.reason.join(" ")).not.toMatch(/hårdt pas/i);
    });

    it("AC4: a hard run 30 h ago softens a long day with the hard-last reason", () => {
      const rec = recommend(
        {
          progression: snapshot({ date: PEAK_SUNDAY }),
          lastRun: new Date(PEAK_SUNDAY.getTime() - 30 * HOUR_MS),
          lastRunSummary: summary("hard"),
        },
        PEAK_SUNDAY
      );

      expect(rec.type).toBe("easy");
      expect(rec.reason.join(" ")).toMatch(/hårdt pas/i);
      expect(rec.reason.join(" ")).toMatch(/restituere/i);
    });

    it("AC6: the variation agrees with the pas when the last run was hard", () => {
      // Repair B1/R1: a hard run 30 h ago clears the long day's 24 h buffer, but
      // the legs have not had the 48 h a hard effort owes them. The mix alone
      // would pick the long tur (it is missing) — both cards must read the same
      // state gate and say the same sentence instead.
      const now = PEAK_SUNDAY;
      const lastRun = new Date(now.getTime() - 30 * HOUR_MS);
      const rec = recommend(
        {
          progression: snapshot({ date: now }),
          lastRun,
          lastRunSummary: summary("hard"),
        },
        now
      );

      const activity = (
        hoursAgo: number,
        overrides: Partial<CoachActivityInput> = {}
      ): CoachActivityInput => ({
        type: "Run",
        distance: 8_000,
        movingTime: 2_700,
        averageHeartrate: 125,
        startDate: new Date(now.getTime() - hoursAgo * HOUR_MS),
        ...overrides,
      });
      const activities = [
        activity(30, { averageHeartrate: 160 }),
        activity(78, { distance: 16_000 }),
        activity(126),
        activity(174),
        activity(222),
      ];
      const next = buildNextActivity({
        activities,
        progression: snapshot({ date: now }),
        now,
        raceDate: RACE,
        todayType: rec.type,
      });

      const hardLine =
        "Din sidste tur var et hårdt pas — i dag bliver det en rolig tur, så benene har nået at restituere.";
      expect(rec.type).toBe("easy");
      expect(next.type).toBe(rec.type);
      expect(rec.reason).toContain(hardLine);
      expect(next.reason).toContain(hardLine);
    });

    it("AC2: an easy last run preserves the plan's tempo rhythm", () => {
      const rec = recommend(
        {
          progression: snapshot({ date: SHARPEN_WEDNESDAY }),
          lastRun: new Date(SHARPEN_WEDNESDAY.getTime() - 60 * HOUR_MS),
          lastRunSummary: summary("easy"),
        },
        SHARPEN_WEDNESDAY
      );

      expect(rec.type).toBe("tempo");
    });

    it("AC2: a long run last time turns the long day into an easy run", () => {
      // Repair R1: the long run's residue lasts 48 h — the same window a hard
      // effort owes. Thirty hours is still inside it and clears the 24 h buffer
      // for a long run, so this is exactly the day the gate exists for.
      const rec = recommend(
        {
          progression: snapshot({ date: PEAK_SUNDAY }),
          lastRun: new Date(PEAK_SUNDAY.getTime() - 30 * HOUR_MS),
          lastRunSummary: summary("long", 18),
        },
        PEAK_SUNDAY
      );

      expect(rec.type).toBe("easy");
      expect(rec.reason.join(" ")).toMatch(/lang tur/i);
    });

    it("AC2: a week behind its goal raises the distance to the gap, never over the phase max", () => {
      const budget = intendedWeekKm("burn", BURN_WEDNESDAY);
      const rec = recommend({ weekToDateKm: budget - 10 });

      expect(rec.type).toBe("easy");
      expect(rec.distanceKm).toBe(getPhaseRules("burn", RACE).maxDistanceKm);
      expect(rec.reason.join(" ")).toMatch(/bag ugens planlagte volumen/i);
    });

    it("AC2: a large gap is still capped by the phase max", () => {
      const rec = recommend({ weekToDateKm: 0 });

      expect(rec.type).toBe("easy");
      expect(rec.distanceKm).toBe(getPhaseRules("burn", RACE).maxDistanceKm);
      expect(rec.reason.join(" ")).toMatch(/bag ugens planlagte volumen/i);
    });

    it("AC2: a week at its goal leaves the distance unchanged", () => {
      const budget = intendedWeekKm("burn", BURN_WEDNESDAY);
      const rec = recommend({ weekToDateKm: budget - 0.5 });

      expect(rec.distanceKm).toBe(getPhaseRules("burn", RACE).minDistanceKm);
      expect(rec.reason.join(" ")).not.toMatch(/bag ugens planlagte volumen/i);
    });

    it("AC2: an unknown week tally leaves the distance unchanged", () => {
      expect(recommend({ lastRunSummary: summary("easy") }).distanceKm).toBe(
        recommend().distanceKm
      );
    });

    it("AC1: threads lastRunSummary.distanceKm into the validation context", () => {
      const recovery = ALL_CONSTRAINTS.find((c) => c.id === "recovery-window");
      if (!recovery) throw new Error("recovery-window constraint missing");
      const seen: WorkoutContext[] = [];
      vi.spyOn(recovery, "evaluate").mockImplementation((context) => {
        seen.push(context);
        return null;
      });

      recommend({ lastRunSummary: summary("easy", 12.4) });

      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((context) => context.lastRunDistanceKm === 12.4)).toBe(true);
    });

    it("AC7: the same state input gives an identical recommendation, reason and trace", () => {
      const stateInput = input(SHARPEN_WEDNESDAY, {
        progression: snapshot({ date: SHARPEN_WEDNESDAY }),
        lastRun: new Date(SHARPEN_WEDNESDAY.getTime() - 60 * HOUR_MS),
        lastRunSummary: summary("tempo"),
      });

      expect(JSON.stringify(recommendWorkout(stateInput, SHARPEN_WEDNESDAY))).toBe(
        JSON.stringify(recommendWorkout(stateInput, SHARPEN_WEDNESDAY))
      );
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
