// Stride — workout recommender (issue #32). Turns the athlete's current state
// (progression snapshot, recovery status, football) into one concrete
// next-workout card. Sits on top of the rule engine: phases, week structure and
// the safety limits all come from `lib/coach/engine.ts` — this module only
// decides, it never redefines the rules.
//
// The seven decision steps, in order:
//   1. The phase week plan decides the day's slot (rest / easy / tempo / long).
//   2. Recovery buffer (48 h before tempo, 24 h before easy/long, 72 h with
//      injury history) — broken → rest day.
//   3. Football yesterday → no hard session (tempo downgrades to easy).
//   4. Distance from the phase band (adapt 6–8, burn 8–10, …).
//   5. Improved pace efficiency + optimal load → unlock the band's upper end.
//   6. Intensity: Zone 2 by default; tempo only where the phase allows it.
//   7. Shoe: Vomero everywhere except tempo (Adios Pro 4); assemble the card.
//
// Pure and deterministic: the clock is a parameter, so tests pin any date.

import {
  EASY_MIN_RECOVERY_HOURS,
  getCurrentPhase,
  getPhase,
  getWeekPlan,
  MIN_RECOVERY_HOURS,
  PHASES,
  type PlannedSession,
  ZONE2_CEILING_BPM,
} from "@/lib/coach/engine";
import type { Goal } from "@/lib/training/goals";
import type { ProgressionSnapshot } from "@/lib/training/progression";

/** One day of the recommendation's week strip — the engine's planned session. */
export type WeekDay = PlannedSession;

export interface WorkoutInput {
  /** Carried for future multi-goal support — not yet wired into the recommender. */
  userId: string;
  /** Carried for future multi-goal support — not yet wired into the recommender. */
  goal: Goal;
  progression: ProgressionSnapshot;
  lastRun: Date;
  footballYesterday: boolean;
  /** Athletes with prior injuries get an extra recovery day between runs. */
  injuryHistory?: boolean;
}

export interface WorkoutRecommendation {
  type: "rest" | "easy" | "tempo" | "long";
  distanceKm: number;
  paceRange: { min: string; max: string };
  heartRateCap: number;
  shoe: "vomero" | "adios-pro-4";
  reason: string[];
  weekStrip: WeekDay[];
}

// ── Tunables ────────────────────────────────────────────────────────────────

/** Recovery buffer when the athlete has an injury history: one extra day. */
export const INJURY_RECOVERY_HOURS = 72;

/** A break this long or longer counts as a pause — restart 20% shorter. */
export const PAUSE_DAYS = 14;
export const PAUSE_DISTANCE_FACTOR = 0.8;

/** Heart-rate ceiling for a tempo session, in bpm. */
export const TEMPO_HR_CAP_BPM = 172;

/** Target pace bands per run type, min (fast) → max (slow), in min/km. */
const PACE_RANGES: Record<Exclude<WorkoutRecommendation["type"], "rest">, PaceRange> = {
  easy: { min: "5:45", max: "6:15" },
  long: { min: "5:45", max: "6:15" },
  tempo: { min: "4:45", max: "5:05" },
};

type PaceRange = { min: string; max: string };

// ── Helpers ─────────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;

function hoursSince(from: Date, now: Date): number {
  return (now.getTime() - from.getTime()) / HOUR_MS;
}

/** The Monday of the week `date` falls in, at the same time of day. */
function mondayOfWeek(date: Date): Date {
  const monday = new Date(date);
  monday.setDate(monday.getDate() - ((date.getDay() + 6) % 7));
  return monday;
}

function restCard(reason: string[], weekStrip: WeekDay[]): WorkoutRecommendation {
  return {
    type: "rest",
    distanceKm: 0,
    paceRange: { min: "–", max: "–" },
    heartRateCap: ZONE2_CEILING_BPM,
    shoe: "vomero",
    reason,
    weekStrip,
  };
}

// ── Recommender ─────────────────────────────────────────────────────────────

/**
 * The next workout for an athlete, as a ready-to-render card. `now` defaults to
 * the real clock; pass a fixed date in tests or when previewing another day.
 */
export function recommendWorkout(
  input: WorkoutInput,
  now: Date = new Date()
): WorkoutRecommendation {
  const phase = getCurrentPhase(now);
  const rules = getPhase(phase);
  const weekStrip = getWeekPlan(phase, mondayOfWeek(now));
  const reason: string[] = [];

  // 1. The phase week plan decides the day's slot (rest / easy / tempo / long).
  const slot = weekStrip[(now.getDay() + 6) % 7];
  if (slot.type === "rest") {
    reason.push(`Planlagt hviledag i ${phase}-fasen — restitution er en del af planen.`);
    return restCard(reason, weekStrip);
  }

  // 6. Intensity: tempo only where the phase allows it; otherwise Zone 2.
  let type: "easy" | "tempo" | "long" =
    slot.type === "tempo" && rules.hasTempoSession
      ? "tempo"
      : slot.type === "long"
        ? "long"
        : "easy";

  // 2. Recovery buffer — 48 h before a hard session, 24 h before an easy/long
  // run, 72 h with an injury history. Broken buffer always wins over the slot.
  const recoveryHours = input.injuryHistory
    ? INJURY_RECOVERY_HOURS
    : type === "tempo"
      ? MIN_RECOVERY_HOURS
      : EASY_MIN_RECOVERY_HOURS;
  const gap = hoursSince(input.lastRun, now);
  if (gap < recoveryHours) {
    if (input.injuryHistory) {
      reason.push(
        `Skadehistorik: kroppen får ${INJURY_RECOVERY_HOURS} timer mellem løbeture — kun ${Math.round(gap)} timer siden sidste tur.`
      );
    } else {
      reason.push(
        `Kun ${Math.round(gap)} timer siden sidste løbetur — under ${recoveryHours}-timers restitutionsbufferen før ${type === "tempo" ? "et hårdt pas" : "en rolig tur"}.`
      );
    }
    return restCard(reason, weekStrip);
  }

  // 3. Football yesterday → no hard session.
  if (type === "tempo" && input.footballYesterday) {
    type = "easy";
    reason.push(
      "Fodboldkamp i går — benene er forbelastede, så tempoturen bliver en rolig Zone 2-tur."
    );
  }

  // 4 + 5. Distance from the phase band; progression unlocks the upper end.
  const readyForMore =
    input.progression.readyToIncrease === true && input.progression.paceEfficiency !== null;
  let distanceKm: number;
  if (type === "long") {
    distanceKm = rules.longRunMaxKm;
    reason.push(`Ugens lange tur i ${phase}-fasen — op til ${rules.longRunMaxKm} km i Zone 2.`);
  } else if (readyForMore) {
    distanceKm = rules.maxDistanceKm;
    reason.push(
      `Pace-efficiency data er stabil og belastningen er optimal — klar til ${phase}-fasens øvre distance.`
    );
  } else {
    distanceKm = rules.minDistanceKm;
    reason.push(
      `Distance fra ${phase}-fasens bånd (${rules.minDistanceKm}–${rules.maxDistanceKm} km).`
    );
  }

  // Edge: first runs — without a full history window, hold the adapt minimum.
  if (!input.progression.hasFullWindow) {
    distanceKm = Math.min(distanceKm, PHASES.adapt.minDistanceKm);
    reason.push("Under 4 ugers historik — vi starter forsigtigt på adapt-fasens minimum.");
  }

  // Edge: 14+ day pause — come back 20% shorter.
  if (gap >= PAUSE_DAYS * 24) {
    distanceKm = Math.round(distanceKm * PAUSE_DISTANCE_FACTOR * 10) / 10;
    reason.push(`${PAUSE_DAYS}+ dages pause — distancen er sat 20% ned for en sikker genstart.`);
  }

  const paceRange: PaceRange = PACE_RANGES[type];
  const heartRateCap = type === "tempo" ? TEMPO_HR_CAP_BPM : ZONE2_CEILING_BPM;

  // 7. Shoe: the Adios Pro 4 is tempo-only; everything else runs in the Vomero.
  const shoe: WorkoutRecommendation["shoe"] = type === "tempo" ? "adios-pro-4" : "vomero";

  return { type, distanceKm, paceRange, heartRateCap, shoe, reason, weekStrip };
}
