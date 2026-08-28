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
//   3b. Readiness band (#245) — the same asymmetric readiness the Hjem gauge
//      shows: rest when the body needs restitution, downgrade to easy when
//      readiness is only moderate. Freshness, distinct from the recovery buffer.
//   3c. Week-to-date load (#256) — how much the athlete has ALREADY run this
//      Mon–Sun week vs. the phase week's intended total, prorated to the days
//      elapsed so far (#261): at/over budget → rest, about to blow past it →
//      soften the session instead of stacking it.
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
import { readinessFromRatio } from "@/lib/cobalt/readiness";
import { ensureDate } from "@/lib/db/calendar-date";
import type { Goal } from "@/lib/training/goals";
import type { ProgressionSnapshot } from "@/lib/training/progression";

/** One day of the recommendation's week strip — the engine's planned session. */
type WeekDay = PlannedSession;

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
  /**
   * Running km already covered this Mon–Sun week, through today and NOT
   * counting the session being recommended (issue #256). Optional: callers that
   * don't know the week's tally get the pure phase/recovery/readiness decision,
   * unchanged. Build it with {@link weekToDateDistanceKm} so the week window
   * matches the one the recommender reasons over.
   */
  weekToDateKm?: number;
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
const INJURY_RECOVERY_HOURS = 72;

/** A break this long or longer counts as a pause — restart 20% shorter. */
const PAUSE_DAYS = 14;
const PAUSE_DISTANCE_FACTOR = 0.8;

/** Heart-rate ceiling for a tempo session, in bpm. */
export const TEMPO_HR_CAP_BPM = 172;

/**
 * How much of the phase week's intended volume the week is allowed to reach
 * before the recommender starts holding back (issue #256). The week strip *is*
 * the plan's budget, so the default 1.0 means "never plan past what the phase
 * week intended" — raise it to allow deliberate overreach weeks, lower it to
 * spread the volume even harder. The engine's `MAX_WEEKLY_INCREASE_RATIO` is a
 * separate, week-over-week guard; this one is week-against-plan.
 */
const WEEKLY_VOLUME_RATIO = 1;

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

/** One decimal, for Danish reason copy — "32,5 km", never "32,499999 km". */
function round1(km: number): number {
  return Math.round(km * 10) / 10;
}

/**
 * Running km already covered in the Mon–Sun week `now` falls in (issue #256) —
 * the value {@link WorkoutInput.weekToDateKm} wants. Lives here, next to the
 * gate that consumes it, so both call sites (the coach dashboard and the chat
 * tool) measure the exact week the recommender reasons over: the athlete's
 * Danish calendar days, Monday through today inclusive.
 */
export function weekToDateDistanceKm(
  activities: readonly { type: string; distance: number; startDate: Date | string }[],
  now: Date
): number {
  // Both week boundaries collapse to numbers up front, so the per-activity test
  // is a numeric comparison instead of two `getTime()` calls per row (#261).
  const today = getLocalDate(now);
  const mondayEpoch = mondayOfWeek(today).getTime();
  const todayEpoch = today.getTime();
  return activities
    .filter((activity) => /run/i.test(activity.type))
    .filter((activity) => {
      const dayEpoch = getLocalDate(ensureDate(activity.startDate)).getTime();
      return dayEpoch >= mondayEpoch && dayEpoch <= todayEpoch;
    })
    .reduce((sum, activity) => sum + activity.distance / 1000, 0);
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
 * The next workout for an athlete, as a ready-to-render card. `now` is required
 * (#261): every caller already resolves the request's clock once and threads it
 * through, and a silent `new Date()` default would let a future caller reason
 * over a different instant than the snapshot it passes in.
 */
export function recommendWorkout(input: WorkoutInput, now: Date): WorkoutRecommendation {
  // E2: "which day is it" must read the athlete's Danish calendar day, not the
  // server's UTC one — otherwise the phase, the week's Monday and the slot below
  // flip a day early on a boundary evening. Elapsed-time math keeps `now`.
  const today = getLocalDate(now);
  const phase = getCurrentPhase(today, input.raceDate);
  const rules = getPhaseRules(phase, input.raceDate);
  const weekStrip = getWeekPlan(phase, mondayOfWeek(today), input.raceDate);
  const reason: string[] = [];

  // 1. The phase week plan decides the day's slot (rest / easy / tempo / long).
  const dayOfWeek = (today.getDay() + 6) % 7; // 0 = Mon … 6 = Sun
  const slot = weekStrip[dayOfWeek];
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

  // 3b. Readiness band (#245): read freshness through the exact same
  // readinessFromRatio the Hjem gauge uses, so the coach's language can never
  // contradict the gauge for the same acute:chronic ratio. This is a fitness
  // read, separate from the recovery buffer above (time since the last run) —
  // both inform the card, but they answer different questions.
  //   • rest  (<68%) → the body needs restitution: no run today.
  //   • easy (68–79%) → downgrade a hard/long session to a rolig tur.
  //   • ready (≥80%) → keep the planned session and say so positively.
  const readiness = readinessFromRatio(input.progression.trainingLoad.ratio);
  if (readiness.band === "rest") {
    reason.push(
      `Din readiness er på ${readiness.pct}% — ${readiness.note.toLowerCase()}. Din krop har brug for restitution i dag.`
    );
    return restCard(reason, weekStrip);
  }
  if (readiness.band === "easy") {
    if (type !== "easy") {
      type = "easy";
    }
    reason.push(
      `Din readiness er på ${readiness.pct}% — ${readiness.note.toLowerCase()}. Overvej en rolig tur i dag frem for et hårdt pas.`
    );
  } else {
    reason.push(`Din readiness er på ${readiness.pct}% — du er klar til dagens pas.`);
  }

  // 3c. Week-to-date load (#256). The week strip is the phase's own budget for
  // the week, so its planned distances sum to what this week is meant to hold.
  // An athlete who has already covered that budget doesn't need another session
  // — even at healthy readiness and with the recovery buffer clear, one more run
  // stacks load onto a full week instead of spreading it. Only active when the
  // caller knows the week's tally; the scale-down half of the gate sits just
  // below the distance step, where today's km are known.
  const intendedWeeklyKm = weekStrip.reduce((sum, day) => sum + (day.distanceKm ?? 0), 0);
  // #261: prorate the budget by how far into the week we are, so the gate asks
  // "have you already run more than this week's share through today?" rather
  // than "have you run the whole week's plan?". The full-week comparison let an
  // athlete stack Mon–Wed with the entire week's volume and still be waved
  // through — exactly the back-to-back-hard-days pattern #256 exists to stop.
  // Sunday's fraction is 1, so a week run to plan ends on the same budget.
  const weekFraction = Math.min(1, (dayOfWeek + 1) / 7);
  const proratedWeeklyKm = intendedWeeklyKm * weekFraction;
  const weekBudgetKm = proratedWeeklyKm * WEEKLY_VOLUME_RATIO;
  const weekToDateKm = input.weekToDateKm;
  const weekLoadKnown = weekToDateKm != null && intendedWeeklyKm > 0;
  if (weekLoadKnown && weekToDateKm >= weekBudgetKm) {
    reason.push(
      `Du har allerede løbet ${round1(weekToDateKm)} km i denne uge — ugens planlagte volumen i ${phase}-fasen er ${round1(proratedWeeklyKm)} km indtil i dag, så i dag er en hviledag.`
    );
    return restCard(reason, weekStrip);
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

  // 3c (cont.). Today's session would push the week past its budget — scale it
  // down rather than let the week overshoot. The complaint behind #256 is
  // specifically back-to-back hard days, so the effort goes first: a tempo/long
  // becomes a rolig Zone 2-tur, and only if that alone doesn't fit does the
  // distance drop to the phase minimum. Never raises anything — every step is a
  // `Math.min`, so the pause and no-full-window clamps above still hold.
  if (weekLoadKnown && weekToDateKm + distanceKm > weekBudgetKm) {
    if (type !== "easy") {
      const softened = type;
      type = "easy";
      distanceKm = Math.min(distanceKm, readyForMore ? rules.maxDistanceKm : rules.minDistanceKm);
      reason.push(
        `Du har løbet ${round1(weekToDateKm)} km af ugens ${round1(proratedWeeklyKm)} km — ${softened === "tempo" ? "tempopasset" : "den lange tur"} bliver en rolig Zone 2-tur, så ugen ikke stables med hårde dage.`
      );
    }
    if (weekToDateKm + distanceKm > weekBudgetKm) {
      distanceKm = Math.min(distanceKm, rules.minDistanceKm);
      reason.push(
        `Ugens volumen er næsten brugt (${round1(weekToDateKm)} af ${round1(proratedWeeklyKm)} km) — distancen holdes på ${phase}-fasens minimum på ${rules.minDistanceKm} km.`
      );
    }
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
