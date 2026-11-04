// Stride — workout recommender (issue #32). Turns the athlete's current state
// (progression snapshot, recovery status, football) into one concrete
// next-workout card. Sits on top of the rule engine: phases, week structure and
// the safety limits all come from `lib/coach/engine.ts` — this module only
// decides, it never redefines the rules.
//
// The seven decision steps, in order:
//   1. The phase week plan decides the day's slot (rest / easy / tempo / long).
//      A rest slot is a preference, not a command (#332): the state gates below
//      decide whether it becomes the phase's easy run. Taper rest days are the
//      deliberate exception.
//   2. Recovery buffer (48 h before tempo, 24 h before easy/long, 72 h with
//      injury history) — broken → rest day.
//   3. Football yesterday → no hard session (tempo downgrades to easy).
//   3a. Load-risk guard (#330) — the same `trainingLoad.risk` the dashboard's
//      gauge shows: high risk → rest (injury risk beats the planned slot);
//      elevated → soften a hard tempo to easy but do not block the day. This is
//      a *different* mechanic from the readiness band below: risk vs. freshness.
//   3b. Readiness band (#245) — the same asymmetric readiness the Hjem gauge
//      shows: rest when the body needs restitution, downgrade to easy when
//      readiness is only moderate. Freshness, distinct from the recovery buffer.
//   3c. Week-to-date load (#256) — how much the athlete has ALREADY run this
//      Mon–Sun week vs. the phase week's intended total, prorated to the days
//      elapsed so far (#261): at/over budget → rest, about to blow past it →
//      soften the session instead of stacking it.
//   3d. State shape (#333) — a pause of 3+ days restarts easy, and a hard
//      (Z4–Z5) or long last run inside the 48 h residue window must not stack
//      another quality/long day on top. Z3 tempo is ordinary aerobic work and
//      does not gate. Both reads sit after every rest gate, so they only soften
//      a day the safety rules already allowed.
//   4. Distance from the phase band (adapt 6–8, burn 8–10, …); a week behind
//      its goal may close the gap, clamped inside the band.
//   5. A measured week-over-week pace-efficiency comparison + optimal load →
//      unlock the band's upper end. "There is a number" is not a measurement:
//      without the comparison (too little history, no HR data) the upper
//      distance stays locked (#336).
//   6. Intensity: Zone 2 by default; tempo only where the phase allows it.
//   7. Shoe: Vomero everywhere except tempo (Adios Pro 4); assemble the card.
//
// Pure and deterministic: the clock is a parameter, so tests pin any date.

import {
  type ConstraintTrace,
  getCurrentPhase,
  getLocalDate,
  getPhaseRules,
  getWeekPlan,
  type SessionRisk,
  type SessionType,
  traceWorkout,
  validateWorkout,
  type WorkoutContext,
  ZONE2_CEILING_BPM,
} from "@/lib/coach/engine";
import { resolveDistance } from "@/lib/coach/recommender/distance";
import { assessState } from "@/lib/coach/recommender/risk";
import { applyGates, resolveSlot } from "@/lib/coach/recommender/steps";
import type { RunKind } from "@/lib/coach/run-character";
import { ensureDate } from "@/lib/db/calendar-date";
import type { Goal } from "@/lib/training/goals";
import type { ProgressionSnapshot } from "@/lib/training/progression";

/**
 * Uge-over-uge-aflæsningen af pace-effektiviteten (issue #336). Begge tal er
 * det samme mål coachens pace-trend-kort plottet — median speed-per-heartbeat
 * ×1000 over det rullende 4-ugers vindue, nu og 7 dage tidligere — men læst
 * som en sammenligning. Enten er sammenligningen der, eller den er der ikke:
 * en sammenligning der ikke kan foretages, er aldrig "stabil".
 */
export interface PaceEfficiencyTrend {
  /** Det 4-ugers vindue der slutter nu. */
  current: number;
  /** Det samme vindue 7 dage tidligere. */
  previous: number;
}

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
  /**
   * Sidste turs data — karakteren af turen, ikke kun hvornår den var (issue
   * #333). Describes the same run as {@link lastRun}; omitted, the recommender
   * keeps the pre-#333 state read exactly as it was.
   */
  lastRunSummary?: {
    distanceKm: number;
    /**
     * Carried for AC1/#333 — not yet read by the recommender; the last run's
     * character is what gates the day. Kept on the input so callers answer
     * "how long was it" without a second lookup when a rule needs it.
     */
    movingTimeSec: number;
    /** Hvad turen VAR (klassificeret med det fælles modul), ikke hvad Strava kaldte den. */
    character: RunKind;
  };
  /**
   * Uge-over-uge-sammenligningen af pace-effektiviteten (issue #336) — samme
   * signal som coachens pace-trend-kort plottet, kun læst som en sammenligning.
   * Uden feltet kan step 5 ikke låse den øvre distance op: "der er et tal" er
   * ikke "data er stabil", og "vi ved det ikke" er ikke "det er stabilt".
   */
  paceEfficiencyTrend?: PaceEfficiencyTrend;
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
  /**
   * The recovery window (hours) the recommender enforced between the last run
   * and the next one: 24 for an easy/long run, 48 before tempo, 72 with an
   * injury history. Carried so surfaces that quote the window state the
   * engine's actual requirement instead of re-deriving it from `type`.
   */
  recoveryHours: number;
  /**
   * The engine's whole rule set traced against the exact context
   * `validateWorkout` evaluated, built before the downgrade below (issue #301)
   * — every constraint, one row each, blocked/warning/passed/not-applicable.
   * When a hard rule blocks the assembled pas, the trace still names that rule
   * beside the downgraded card. Carried so the coach surface can show why this
   * pas, from the same context that produced it; early rest cards carry no
   * trace (their `reason` lines are the explanation).
   */
  trace: ConstraintTrace[];
}

// ── Tunables ────────────────────────────────────────────────────────────────

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

/** The Monday of the week `date` falls in, at the same time of day. */
function mondayOfWeek(date: Date): Date {
  const monday = new Date(date);
  monday.setDate(monday.getDate() - ((date.getDay() + 6) % 7));
  return monday;
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

function restCard(reason: string[], recoveryHours: number): WorkoutRecommendation {
  return {
    type: "rest",
    distanceKm: 0,
    paceRange: { min: "–", max: "–" },
    heartRateCap: ZONE2_CEILING_BPM,
    shoe: "vomero",
    reason,
    recoveryHours,
    // An early rest stops before the engine's validation step, so there is no
    // context to trace — the reason lines carry the why (issue #301).
    trace: [],
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
  // The phase week plan is the recommender's own budget for the week: it decides
  // today's slot (step 1) and what the week is meant to hold (step 3c). It never
  // leaves this function — no surface renders a Mon–Sun strip (issue #291).
  const weekPlan = getWeekPlan(phase, mondayOfWeek(today), input.raceDate);

  const slot = resolveSlot({ today, phase, rules, weekPlan });
  const state = assessState({
    input,
    now,
    slotType: slot.type,
    dayOfWeek: slot.dayOfWeek,
    weekPlan,
  });
  const gates = applyGates({
    phase,
    slot,
    state,
    injuryHistory: input.injuryHistory ?? false,
  });
  if (gates.kind === "rest") return restCard(gates.reason, gates.recoveryHours);

  const distance = resolveDistance({
    phase,
    rules,
    type: gates.type,
    progression: input.progression,
    paceEfficiencyTrend: input.paceEfficiencyTrend,
    raceDate: input.raceDate,
    longPause: state.longPause,
    week: state.week,
  });
  const { type, distanceKm } = distance;
  const reason = [...gates.reason, ...distance.reason];

  return finalizeCard({
    input,
    now,
    phase,
    rules,
    type,
    distanceKm,
    reason,
    recoveryHours: state.recoveryHours,
  });
}

interface FinalizeInput {
  input: WorkoutInput;
  now: Date;
  phase: WorkoutContext["phase"];
  rules: ReturnType<typeof getPhaseRules>;
  type: Exclude<RecommendedType, "rest">;
  distanceKm: number;
  reason: string[];
  recoveryHours: number;
}

/**
 * 7. Shoe — the Adios Pro 4 is tempo-only; everything else runs in the Vomero.
 * B3: validate the assembled card against the rule engine before it leaves the
 * recommender. The card is built from the same phase rules the constraints
 * enforce, so this is a defensive last line — but a hard (blocking) issue means
 * it would break a safety rule, so downgrade to a safe easy Zone 2 run rather
 * than surface a violating card.
 */
function finalizeCard(input: FinalizeInput): WorkoutRecommendation {
  let { type, distanceKm } = input;
  const reason = input.reason;
  let plannedZone = type === "tempo" ? 4 : 2;
  let shoe: WorkoutRecommendation["shoe"] = type === "tempo" ? "adios-pro-4" : "vomero";

  const validationContext: WorkoutContext = {
    plannedDate: input.now,
    plannedType: type,
    plannedDistanceKm: distanceKm,
    plannedZone,
    shoeType: shoe,
    lastRunDate: input.input.lastRun,
    lastRunDistanceKm: input.input.lastRunSummary?.distanceKm,
    footballYesterday: input.input.footballYesterday,
    phase: input.phase,
    risk: input.input.risk,
    raceDate: input.input.raceDate,
  };
  const validation = validateWorkout(validationContext);
  // #301: trace the SAME context instance validateWorkout just evaluated — the
  // rule list can never describe a different pas than the one that was blocked.
  // Built before the downgrade below, so the blocking rule stays visible next to
  // the downgraded card; that is the point of the trace.
  const trace = traceWorkout(validationContext);
  if (validation.issues.length > 0) {
    type = "easy";
    plannedZone = 2;
    shoe = "vomero";
    distanceKm = Math.min(distanceKm, input.rules.maxDistanceKm);
    reason.push(
      `Forslaget brød en hård regel (${validation.issues[0].constraintId}) — nedjusteret til en rolig Zone 2-tur.`
    );
  }

  const paceRange: PaceRange = PACE_RANGES[type];
  const heartRateCap = type === "tempo" ? TEMPO_HR_CAP_BPM : ZONE2_CEILING_BPM;

  return {
    type,
    distanceKm,
    paceRange,
    heartRateCap,
    shoe,
    reason,
    recoveryHours: input.recoveryHours,
    trace,
  };
}
