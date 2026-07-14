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
  getLocalDate,
  getPhaseRules,
  getWeekPlan,
  MIN_RECOVERY_HOURS,
  type PlannedSession,
  type SessionRisk,
  type SessionType,
  validateWorkout,
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
  /** Optional caller risk read, threaded into the engine's validation context. */
  risk?: SessionRisk;
  /** The user's race date (issue #99); omitted → the engine's demo default. */
  raceDate?: Date;
}

/**
 * The subset of the engine's {@link SessionType} vocabulary the recommender can
 * ever prescribe (issue #71 A2). Deriving it via `Extract` keeps the two in
 * lockstep — renaming or dropping one of these in the engine breaks here at
 * compile time rather than drifting silently.
 */
export type RecommendedType = Extract<SessionType, "rest" | "easy" | "tempo" | "long">;

export interface WorkoutRecommendation {
  type: RecommendedType;
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

/** Target pace bands per run type, min (fast) → max (slow), in min/km.
 * Exported so the plan page's target metas quote the same bands the
 * recommender prescribes — one source of truth for "what pace is an easy run". */
export const PACE_RANGES: Record<Exclude<WorkoutRecommendation["type"], "rest">, PaceRange> = {
  easy: { min: "5:45", max: "6:15" },
  long: { min: "5:45", max: "6:15" },
  tempo: { min: "4:45", max: "5:05" },
};

type PaceRange = { min: string; max: string };

// ── Helpers ─────────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;

// Klemmes til ≥ 0: et ur foran serverens UTC må aldrig give et negativt gap.
function hoursSince(from: Date, now: Date): number {
  return Math.max(0, (now.getTime() - from.getTime()) / HOUR_MS);
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
  // E2: "which day is it" must read the athlete's Danish calendar day, not the
  // server's UTC one — otherwise the phase, the week's Monday and the slot below
  // flip a day early on a boundary evening. Elapsed-time math keeps `now`.
  const today = getLocalDate(now);
  const phase = getCurrentPhase(today, input.raceDate);
  const rules = getPhaseRules(phase, input.raceDate);
  const weekStrip = getWeekPlan(phase, mondayOfWeek(today), input.raceDate);
  const reason: string[] = [];

  // 1. The phase week plan decides the day's slot (rest / easy / tempo / long).
  const slot = weekStrip[(today.getDay() + 6) % 7];
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
  // B6: `readyToIncrease` is null when load data is missing — guard it to false
  // (not ready) so a null never reads as "unlock the upper distance".
  const readyToIncrease = input.progression.readyToIncrease ?? false;
  const readyForMore = readyToIncrease && input.progression.paceEfficiency !== null;
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
    distanceKm = Math.min(distanceKm, getPhaseRules("adapt", input.raceDate).minDistanceKm);
    reason.push("Under 4 ugers historik — vi starter forsigtigt på adapt-fasens minimum.");
  }

  // Edge: 14+ day pause — come back 20% shorter.
  if (gap >= PAUSE_DAYS * 24) {
    distanceKm = Math.round(distanceKm * PAUSE_DISTANCE_FACTOR * 10) / 10;
    reason.push(`${PAUSE_DAYS}+ dages pause — distancen er sat 20% ned for en sikker genstart.`);
  }

  // B5: the phase's `maxDistanceKm` is the upper bound the week strip agrees on.
  // Clamp band runs (easy/tempo) to it so the card never exceeds the plan; a
  // ready-to-progress athlete may reach up to 15% beyond it. The long run has
  // its own `longRunMaxKm` ceiling and is exempt.
  if (type !== "long") {
    const upperBound = readyForMore
      ? Math.round(rules.maxDistanceKm * 1.15 * 10) / 10
      : rules.maxDistanceKm;
    distanceKm = Math.min(distanceKm, upperBound);
  }

  // 7. Shoe: the Adios Pro 4 is tempo-only; everything else runs in the Vomero.
  let plannedZone = type === "tempo" ? 4 : 2;
  let shoe: WorkoutRecommendation["shoe"] = type === "tempo" ? "adios-pro-4" : "vomero";

  // B3: validate the assembled recommendation against the rule engine before it
  // leaves the recommender. The recommendation is built from the same phase
  // rules the constraints enforce, so this is a defensive last line — but a hard
  // (blocking) issue means it would break a safety rule, so downgrade to a safe
  // easy Zone 2 run rather than surface a violating card.
  const validation = validateWorkout({
    plannedDate: now,
    plannedType: type,
    plannedDistanceKm: distanceKm,
    plannedZone,
    shoeType: shoe,
    lastRunDate: input.lastRun,
    footballYesterday: input.footballYesterday,
    phase,
    risk: input.risk,
    raceDate: input.raceDate,
  });
  if (validation.issues.length > 0) {
    type = "easy";
    plannedZone = 2;
    shoe = "vomero";
    distanceKm = Math.min(distanceKm, rules.maxDistanceKm);
    reason.push(
      `Forslaget brød en hård regel (${validation.issues[0].constraintId}) — nedjusteret til en rolig Zone 2-tur.`
    );
  }

  const paceRange: PaceRange = PACE_RANGES[type];
  const heartRateCap = type === "tempo" ? TEMPO_HR_CAP_BPM : ZONE2_CEILING_BPM;

  return { type, distanceKm, paceRange, heartRateCap, shoe, reason, weekStrip };
}
