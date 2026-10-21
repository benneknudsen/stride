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
  EASY_MIN_RECOVERY_HOURS,
  getCurrentPhase,
  getLocalDate,
  getPhaseRules,
  getWeekPlan,
  MIN_RECOVERY_HOURS,
  type SessionRisk,
  type SessionType,
  traceWorkout,
  validateWorkout,
  type WorkoutContext,
  ZONE2_CEILING_BPM,
} from "@/lib/coach/engine";
import { dayShapeGate, dayShapeReason, type RunKind } from "@/lib/coach/run-character";
import { readinessFromRatio } from "@/lib/cobalt/readiness";
import { ensureDate } from "@/lib/db/calendar-date";
import type { Goal } from "@/lib/training/goals";
import {
  daysUntilRiskFalls,
  type ProgressionSnapshot,
  type TrainingLoad,
} from "@/lib/training/progression";

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

/** Recovery buffer when the athlete has an injury history: one extra day. */
const INJURY_RECOVERY_HOURS = 72;

/**
 * A break this long or longer counts as a long pause — restart 20% shorter.
 * Not the same concept as `PAUSE_RESTART_DAYS` (3) in `run-character.ts`: that
 * one describes *today's form* after a short break and only gates the day
 * shape; this one is the long-pause restart that scales the whole run down.
 */
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

/** One decimal with a Danish decimal comma — "4,2", never "4.2". */
function decimalComma(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

/** Nearest half kilometre — the grid prescribed distances sit on. */
function roundHalf(km: number): number {
  return Math.round(km * 2) / 2;
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

/** " (1,6× dit 4-ugers fundament)" — Danish decimal comma for the load ratio. */
function loadRatioClause(load: TrainingLoad): string {
  if (load.ratio === null) return "";
  const ratio = load.ratio.toFixed(1).replace(".", ",");
  return ` (${ratio}× dit 4-ugers fundament)`;
}

/**
 * The reason a high acute:chronic risk forces rest (#330). This is a *risk*
 * guard, not a restatement of the readiness band: readiness maps the same ratio
 * to freshness (and reads only "easy" at ratio 1.6), while the risk band says
 * the runner is in the injury-risk zone. The countdown comes from the EWMA
 * decay in `daysUntilRiskFalls` — deterministic, and it only claims when the
 * *classification* drops, not when the runner is recovered.
 */
function highRiskRestReason(load: TrainingLoad): string {
  const days = daysUntilRiskFalls(load);
  const countdown =
    days === null
      ? ""
      : ` Uden løb falder belastningen under høj-risiko om ${days} ${days === 1 ? "dag" : "dage"}.`;
  return `Høj skadesrisiko${loadRatioClause(load)}: et nyt pas er ikke forsvarligt. Kroppen skal have restitution.${countdown}`;
}

/**
 * The softened reason for the elevated band (#330): a caution, not a stop. Only
 * a hard tempo session is downgraded — easy and long Zone 2 runs stay.
 */
function elevatedRiskReason(load: TrainingLoad): string {
  return `Belastningen er forhøjet${loadRatioClause(load)} — tempopasset bliver en rolig Zone 2-tur, så risikoen ikke stiger.`;
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
  const reason: string[] = [];
  // #330: the dashboard's own load-risk band is the single source for risk. The
  // readiness mapping below answers "how fresh is the runner?"; this answers
  // "is another run safe?". They can disagree at ratio 1.5–1.72 — readiness
  // says easy, risk says high — and risk must win the prescription.
  const load = input.progression.trainingLoad;
  const loadRisk = load.risk;
  const highRiskReason = loadRisk === "high" ? highRiskRestReason(load) : null;

  // 1. The phase week plan decides the day's slot (rest / easy / tempo / long).
  // A rest slot is a preference, not a command (#332): the gates below decide
  // whether the state allows the phase's easy run instead. The taper week is
  // the deliberate exception — its rest days are part of the race-week shape.
  const dayOfWeek = (today.getDay() + 6) % 7; // 0 = Mon … 6 = Sun
  const slot = weekPlan[dayOfWeek];
  const restSlot = slot.type === "rest";
  if (restSlot && phase === "taper") {
    reason.push(
      `Planlagt hviledag i ${phase}-fasen — nedtrapningen er bevidst, og restitution er en del af planen.`
    );
    if (highRiskReason) reason.push(highRiskReason);
    return restCard(reason, input.injuryHistory ? INJURY_RECOVERY_HOURS : EASY_MIN_RECOVERY_HOURS);
  }

  // 6. Intensity: tempo only where the phase allows it; otherwise Zone 2. A
  // rest slot is read as an easy day, so the state gates can still turn it into
  // the phase band's easy run when nothing else asks for rest.
  let type: "easy" | "tempo" | "long" = "easy";
  if (slot.type === "long") type = "long";
  else if (slot.type === "tempo" && rules.hasTempoSession) type = "tempo";

  // 2. Recovery buffer — 48 h before a hard session, 24 h before an easy/long
  // run, 72 h with an injury history. Broken buffer always wins over the slot.
  const recoveryHours = input.injuryHistory
    ? INJURY_RECOVERY_HOURS
    : type === "tempo"
      ? MIN_RECOVERY_HOURS
      : EASY_MIN_RECOVERY_HOURS;
  const gap = hoursSince(input.lastRun, now);
  const longPause = gap >= PAUSE_DAYS * 24;
  if (gap < recoveryHours) {
    // Even when the buffer is the proximate cause, the high-risk read belongs on
    // the card: the runner must know the rest is not only about elapsed time.
    if (highRiskReason) reason.push(highRiskReason);
    if (input.injuryHistory) {
      reason.push(
        `Skadehistorik: kroppen får ${INJURY_RECOVERY_HOURS} timer mellem løbeture — kun ${Math.round(gap)} timer siden sidste tur.`
      );
    } else {
      reason.push(
        `Kun ${Math.round(gap)} timer siden sidste løbetur — under ${recoveryHours}-timers restitutionsbufferen før ${type === "tempo" ? "et hårdt pas" : "en rolig tur"}.`
      );
    }
    return restCard(reason, recoveryHours);
  }

  // 3a. Load-risk guard (#330): acute:chronic risk is a separate mechanic from
  // readiness (injury risk vs. freshness). High risk always wins over the slot,
  // exactly like a broken recovery buffer above. Elevated is a caution, not a
  // stop: it downgrades the hard tempo session but leaves easy/long Zone 2 runs.
  if (highRiskReason) {
    reason.push(highRiskReason);
    return restCard(reason, recoveryHours);
  }
  let elevatedReason: string | null = null;
  if (loadRisk === "elevated" && type === "tempo") {
    type = "easy";
    elevatedReason = elevatedRiskReason(load);
  }

  // 3. Football yesterday → no hard session.
  let footballReason: string | null = null;
  if (type === "tempo" && input.footballYesterday) {
    type = "easy";
    footballReason =
      "Fodboldkamp i går — benene er forbelastede, så tempoturen bliver en rolig Zone 2-tur.";
  }

  // 3b. Readiness band (#245): read freshness through the exact same
  // readinessFromRatio the Hjem gauge uses, so the coach's language can never
  // contradict the gauge for the same acute:chronic ratio. This is a fitness
  // read, separate from the recovery buffer above (time since the last run) —
  // both inform the card, but they answer different questions.
  //   • rest  (<68%) → the body needs restitution: no run today.
  //   • easy (68–79%) → downgrade a hard/long session to a rolig tur.
  //   • ready (≥80%) → keep the planned session and say so positively.
  const readiness = readinessFromRatio(load.ratio);
  if (readiness.band === "rest") {
    reason.push(
      `Din readiness er på ${readiness.pct}% — ${readiness.note.toLowerCase()}. Din krop har brug for restitution i dag.`
    );
    return restCard(reason, recoveryHours);
  }
  let readinessReason: string;
  if (readiness.band === "easy") {
    type = "easy";
    readinessReason = `Din readiness er på ${readiness.pct}% — ${readiness.note.toLowerCase()}. Overvej en rolig tur i dag frem for et hårdt pas.`;
  } else {
    readinessReason = `Din readiness er på ${readiness.pct}% — du er klar til dagens pas.`;
  }

  // 3c. Week-to-date load (#256). The week strip is the phase's own budget for
  // the week, so its planned distances sum to what this week is meant to hold.
  // An athlete who has already covered that budget doesn't need another session
  // — even at healthy readiness and with the recovery buffer clear, one more run
  // stacks load onto a full week instead of spreading it. Only active when the
  // caller knows the week's tally; the scale-down half of the gate sits just
  // below the distance step, where today's km are known.
  const intendedWeeklyKm = weekPlan.reduce((sum, day) => sum + (day.distanceKm ?? 0), 0);
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
    return restCard(reason, recoveryHours);
  }

  // 3d. State-based day shape (#333). One shared read — the same `dayShapeGate`
  // the variation card calls — decides what the break and the last run's
  // character allow; this card only applies it to today's slot. The read happens
  // after every rest gate, so it can only soften a run the safety rules already
  // allowed — never override a hviledag. Pause first: after a break the restart
  // is a rolig tur, then the last run's own residue: a hard or long run must not
  // stack. Z3 tempo is not residue (see `run-character.ts`).
  const gate = dayShapeGate({
    character: input.lastRunSummary?.character ?? null,
    gapHours: gap,
  });
  if (gate && (type === "tempo" || type === "long")) type = "easy";

  // No gate turned the day into hvile, so the run-facing reason lines belong on
  // the card now — in their original order (#332). Deferring them past the
  // week-budget gate above keeps a budget rest card from claiming "du er klar
  // til dagens pas" (or "overvej en rolig tur") beside "i dag er en hviledag".
  if (elevatedReason) reason.push(elevatedReason);
  if (footballReason) reason.push(footballReason);
  reason.push(readinessReason);
  // A 14+ day break is the long-pause line's story; the 3-day gate must not
  // repeat it in different words on the same card (#333 repair R2).
  if (gate && !(gate === "pause" && longPause)) reason.push(dayShapeReason(gate, gap));

  // No gate held the runner back, so a rest slot becomes the phase's easy run.
  // The reason names the calendar as a preference and the state as the decision,
  // never the other way around (issue #332).
  if (restSlot) {
    reason.push(
      `Ugens hviledag i ${phase}-fasen var en præference — tilstanden tillader en rolig tur, så dagen bliver et let pas i planens bånd.`
    );
  }

  // 4 + 5. Distance from the phase band; progression unlocks the upper end.
  // B6: `readyToIncrease` is null when load data is missing — guard it to false
  // (not ready) so a null never reads as "unlock the upper distance".
  const readyToIncrease = input.progression.readyToIncrease ?? false;
  // #336: the upper end unlocks on a MEASURED week-over-week comparison, never
  // on "a number exists". `paceEfficiency !== null` only said "there is a
  // value", so a runner whose efficiency fell since last week still got the
  // band's upper distance and a reason that called the data stable. The rule
  // is "not worse than last week" (nu >= sidste uge), read on the same one
  // decimal the card prints — so the numbers the reason quotes are the numbers
  // the rule compared, and a change below that precision is noise, not a
  // regression. Without the comparison there is no unlock: "vi ved det ikke" er
  // ikke "det er stabilt".
  const trend = input.paceEfficiencyTrend;
  const comparison = trend
    ? { current: round1(trend.current), previous: round1(trend.previous) }
    : null;
  const paceEfficiencyNotWorse = comparison !== null && comparison.current >= comparison.previous;
  const readyForMore =
    readyToIncrease && input.progression.paceEfficiency !== null && paceEfficiencyNotWorse;
  let distanceKm: number;
  if (type === "long") {
    distanceKm = rules.longRunMaxKm;
    reason.push(`Ugens lange tur i ${phase}-fasen — op til ${rules.longRunMaxKm} km i Zone 2.`);
  } else if (readyForMore && comparison !== null) {
    distanceKm = rules.maxDistanceKm;
    reason.push(
      `Pace-effektiviteten er ikke faldet siden sidste uge (${decimalComma(comparison.current)} mod ${decimalComma(comparison.previous)}) og belastningen er optimal — klar til ${phase}-fasens øvre distance.`
    );
  } else {
    distanceKm = rules.minDistanceKm;
    reason.push(
      `Distance fra ${phase}-fasens bånd (${rules.minDistanceKm}–${rules.maxDistanceKm} km).`
    );
    // The comparison was made and it went the wrong way — say so, so the card
    // never leaves the runner guessing why the upper distance stayed shut.
    if (comparison !== null && !paceEfficiencyNotWorse) {
      reason.push(
        `Pace-effektiviteten er faldet siden sidste uge (${decimalComma(comparison.current)} mod ${decimalComma(comparison.previous)}) — ${phase}-fasens øvre distance er ikke låst op.`
      );
    }
  }

  // 3c (cont.) + #333: when the week is behind its plan through today, today's
  // easy/long run may close the gap. The target is clamped inside the phase
  // band, so it can raise a run but never past the phase max — and the
  // scale-down gate below still has the final word if the raised distance would
  // overshoot the week. The reason is held back until then (#333 repair): a
  // line claiming the run is "lidt længere" must not sit beside a line saying
  // the distance was cut to the phase minimum.
  let weekGap: { targetKm: number; reason: string } | null = null;
  const canCloseWeekGap =
    weekLoadKnown &&
    weekToDateKm < proratedWeeklyKm &&
    weekBudgetKm - weekToDateKm > rules.minDistanceKm + 1.0 &&
    (type === "easy" || type === "long");
  if (canCloseWeekGap) {
    const weekGapKm = weekBudgetKm - weekToDateKm;
    const gapDistanceKm = Math.min(
      rules.maxDistanceKm,
      Math.max(rules.minDistanceKm, roundHalf(weekGapKm))
    );
    if (gapDistanceKm > distanceKm) {
      distanceKm = gapDistanceKm;
      weekGap = {
        targetKm: gapDistanceKm,
        reason: `Du er ${round1(proratedWeeklyKm - weekToDateKm)} km bag ugens planlagte volumen indtil i dag (${round1(proratedWeeklyKm)} km) — dagens tur er derfor lidt længere, så ugen følger med.`,
      };
    }
  }

  // Edge: first runs — without a full history window, hold the adapt minimum.
  if (!input.progression.hasFullWindow) {
    distanceKm = Math.min(distanceKm, getPhaseRules("adapt", input.raceDate).minDistanceKm);
    reason.push("Under 4 ugers historik — vi starter forsigtigt på adapt-fasens minimum.");
  }

  // Edge: 14+ day pause — come back 20% shorter.
  if (longPause) {
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

  // The week-gap line only stands if its raised distance survived every clamp
  // above (#333 repair). If the scale-down cut it back to the minimum, the card
  // already says so and must not also claim today's run is longer.
  if (weekGap !== null && distanceKm === weekGap.targetKm) {
    reason.push(weekGap.reason);
  }

  // 7. Shoe: the Adios Pro 4 is tempo-only; everything else runs in the Vomero.
  let plannedZone = type === "tempo" ? 4 : 2;
  let shoe: WorkoutRecommendation["shoe"] = type === "tempo" ? "adios-pro-4" : "vomero";

  // B3: validate the assembled recommendation against the rule engine before it
  // leaves the recommender. The recommendation is built from the same phase
  // rules the constraints enforce, so this is a defensive last line — but a hard
  // (blocking) issue means it would break a safety rule, so downgrade to a safe
  // easy Zone 2 run rather than surface a violating card.
  const validationContext: WorkoutContext = {
    plannedDate: now,
    plannedType: type,
    plannedDistanceKm: distanceKm,
    plannedZone,
    shoeType: shoe,
    lastRunDate: input.lastRun,
    lastRunDistanceKm: input.lastRunSummary?.distanceKm,
    footballYesterday: input.footballYesterday,
    phase,
    risk: input.risk,
    raceDate: input.raceDate,
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
    distanceKm = Math.min(distanceKm, rules.maxDistanceKm);
    reason.push(
      `Forslaget brød en hård regel (${validation.issues[0].constraintId}) — nedjusteret til en rolig Zone 2-tur.`
    );
  }

  const paceRange: PaceRange = PACE_RANGES[type];
  const heartRateCap = type === "tempo" ? TEMPO_HR_CAP_BPM : ZONE2_CEILING_BPM;

  return { type, distanceKm, paceRange, heartRateCap, shoe, reason, recoveryHours, trace };
}
