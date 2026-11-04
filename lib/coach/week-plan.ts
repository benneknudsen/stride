import { addDays, daysUntil, getPhaseRules } from "./phase";
import {
  DEFAULT_RACE_DATE,
  DEFAULT_RACE_NAME,
  type EasySubtype,
  HALF_MARATHON_KM,
  type PhaseKey,
  type PhaseRules,
  type PlannedSession,
  type SessionType,
  WEEKDAYS,
  type Weekday,
} from "./types";

// ── Week plan ─────────────────────────────────────────────────────────────────

/**
 * Which weekdays carry a run, keyed by the phase's `sessionsPerWeek`. The long
 * run (when present) always lands on Sunday and the tempo mid-week on
 * Wednesday. Layouts respect the recovery windows: the Wednesday tempo gets
 * `MIN_RECOVERY_HOURS` (types.ts) clear on both sides, and easy/long days never
 * sit closer than `EASY_MIN_RECOVERY_HOURS` (types.ts) — including across the
 * week boundary (Sunday → next Monday).
 */
const WEEK_RUN_DAYS: Record<number, readonly Weekday[]> = {
  3: ["mon", "wed", "sat"],
  4: ["mon", "wed", "fri", "sun"],
  5: ["mon", "wed", "fri", "sat", "sun"],
};

/**
 * A full Mon–Sun training week for a phase, derived from its `PhaseRules`.
 * Easy days sit at the phase's `minDistanceKm` in Zone 2; the tempo (sharpen/
 * peak) uses `maxDistanceKm`; the long run (peak) uses `longRunMaxKm`. Pass
 * `startDate` — treated as the week's Monday — to stamp a concrete date on each
 * day. `raceDate`/`raceName` anchor the taper's race week (issue #99); the
 * defaults keep demo callers on the original plan. `raceDistanceKm` is how far
 * race day actually is (issue #291) — it was a hardcoded 21.1, which quietly
 * prescribed half-marathon volume for a 10K or marathon runner; the default
 * keeps every existing caller on today's behaviour. The result never
 * self-violates the constraint set for its phase.
 */
export function getWeekPlan(
  phase: PhaseKey,
  startDate?: Date,
  raceDate: Date = DEFAULT_RACE_DATE,
  raceName: string = DEFAULT_RACE_NAME,
  raceDistanceKm: number = HALF_MARATHON_KM
): PlannedSession[] {
  const rules = getPhaseRules(phase, raceDate);
  if (phase === "taper") {
    return taperWeekPlan(rules, startDate, raceDate, raceName, raceDistanceKm);
  }
  const runDays = WEEK_RUN_DAYS[rules.sessionsPerWeek] ?? WEEK_RUN_DAYS[4];
  const tempoDay: Weekday | null = rules.hasTempoSession ? "wed" : null;
  const longDay: Weekday | null = rules.hasLongRun ? "sun" : null;

  // The base kind of a run day, before easy days get their subtype (issue #211).
  const baseType = (weekday: Weekday): SessionType => {
    if (weekday === longDay) return "long";
    if (weekday === tempoDay) return "tempo";
    return "easy";
  };

  // Run days in week order, so an easy day can see the run before/after it —
  // wrapping Sunday→Monday, since the week repeats.
  const runIndices = WEEKDAYS.map((_, index) => index).filter((index) =>
    runDays.includes(WEEKDAYS[index])
  );

  // Assign each easy day a subtype: recovery after a hard effort, strides before
  // the long run, and an easy/medium/recovery wave for the rest so the volume
  // rises and falls instead of sitting flat at the minimum.
  const easySubtypes = new Map<number, EasySubtype>();
  const WAVE: EasySubtype[] = ["medium", "easy", "recovery"];
  let waveStep = 0;
  runIndices.forEach((index, pos) => {
    if (baseType(WEEKDAYS[index]) !== "easy") return;
    const prev = baseType(WEEKDAYS[runIndices[(pos - 1 + runIndices.length) % runIndices.length]]);
    const next = baseType(WEEKDAYS[runIndices[(pos + 1) % runIndices.length]]);
    if (next === "long") {
      easySubtypes.set(index, "easy-strides");
    } else if (prev === "long" || prev === "tempo" || prev === "race") {
      easySubtypes.set(index, "recovery");
    } else {
      easySubtypes.set(index, WAVE[waveStep % WAVE.length]);
      waveStep++;
    }
  });

  const midKm = roundHalf((rules.minDistanceKm + rules.maxDistanceKm) / 2);
  const easyKm = (subtype: EasySubtype): number =>
    subtype === "recovery"
      ? rules.minDistanceKm
      : subtype === "medium"
        ? rules.maxDistanceKm
        : midKm;
  const easyDescription: Record<EasySubtype, string> = {
    recovery: "Let restitution",
    easy: "Rolig Z2",
    medium: "Rolig Z2 (lang)",
    "easy-strides": "Rolig + strides",
  };

  return WEEKDAYS.map((weekday, index) => {
    const date = startDate ? addDays(startDate, index) : undefined;

    if (!runDays.includes(weekday)) {
      return { weekday, date, type: "rest", description: "Hvile" };
    }
    if (weekday === longDay) {
      return {
        weekday,
        date,
        type: "long",
        zone: 2,
        distanceKm: rules.longRunMaxKm,
        description: "Lang tur (Z2)",
      };
    }
    if (weekday === tempoDay) {
      return {
        weekday,
        date,
        type: "tempo",
        zone: 4,
        distanceKm: rules.maxDistanceKm,
        description: "Tempo",
      };
    }
    const subtype = easySubtypes.get(index) ?? "easy";
    return {
      weekday,
      date,
      type: "easy",
      easySubtype: subtype,
      zone: 2,
      distanceKm: easyKm(subtype),
      description: easyDescription[subtype],
    };
  });
}

/** Prescribed distances sit on a half-km grid — "7,5 km", never "7,25 km". */
function roundHalf(km: number): number {
  return Math.round(km * 2) / 2;
}

/**
 * The taper week (issue #76 B4). Two shapes:
 *   - Race week (`raceDate` falls inside the given Monday→Sunday span): 2 easy
 *     run days plus race day. A short shakeout the day before the race, a rest
 *     day the day before that, one short easy run early in the week.
 *   - Otherwise a general taper week: up to 3 easy Zone-2 days, no hard efforts,
 *     everything at the phase's reduced `minDistanceKm`.
 * Without a `startDate` (no calendar context) we can't locate the race, so we
 * fall back to the general taper shape.
 */
function taperWeekPlan(
  rules: PhaseRules,
  startDate: Date | undefined,
  raceDate: Date,
  raceName: string,
  raceDistanceKm: number
): PlannedSession[] {
  const raceIndex = startDate ? daysUntil(startDate, raceDate) : -1;
  const isRaceWeek = startDate != null && raceIndex >= 0 && raceIndex <= 6;

  if (isRaceWeek && startDate) {
    return WEEKDAYS.map((weekday, index) => {
      const date = addDays(startDate, index);
      if (index === raceIndex) {
        return {
          weekday,
          date,
          type: "race",
          zone: 5,
          distanceKm: raceDistanceKm,
          description: `Race — ${raceName}`,
        };
      }
      if (index === raceIndex - 1) {
        return {
          weekday,
          date,
          type: "easy",
          zone: 2,
          distanceKm: 2,
          description: "Let udløb (2 km)",
        };
      }
      if (index === raceIndex - 2) {
        return { weekday, date, type: "rest", description: "Hvile før løb" };
      }
      if (index === 0) {
        return {
          weekday,
          date,
          type: "easy",
          zone: 2,
          distanceKm: rules.minDistanceKm,
          description: "Kort rolig tur",
        };
      }
      return { weekday, date, type: "rest", description: "Hvile" };
    });
  }

  const runDays = WEEK_RUN_DAYS[rules.sessionsPerWeek] ?? WEEK_RUN_DAYS[3];
  return WEEKDAYS.map((weekday, index) => {
    const date = startDate ? addDays(startDate, index) : undefined;
    if (!runDays.includes(weekday)) {
      return { weekday, date, type: "rest", description: "Hvile" };
    }
    return {
      weekday,
      date,
      type: "easy",
      zone: 2,
      distanceKm: rules.minDistanceKm,
      description: "Rolig Z2 (nedtrapning)",
    };
  });
}
