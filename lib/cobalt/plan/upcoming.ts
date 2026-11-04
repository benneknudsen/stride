// Cobalt Glass — Plan upcoming weeks and derived plan.
//
// The next three weeks of the build off the phase engine, the runner's own pace
// grid, and the derived plan the live page falls back from when there is no
// prediction to show.

import {
  buildPhases,
  getCurrentPhase,
  getWeekPlan,
  MAX_WEEKLY_INCREASE_RATIO,
  type PhaseKey,
  type PlannedSession,
} from "@/lib/coach/engine";
import { formatDanish, formatWeekSpan } from "@/lib/cobalt/format";
import type { HomeActivityLike } from "@/lib/cobalt/hjem";
import {
  buildRunSuggestions,
  DEFAULT_SESSION_KIND,
  LOW_CONFIDENCE_PACE_SPREAD,
  PACE_RANGE_SPREAD,
  prescribedDistance,
  prescribedWeekKm,
  type RunSuggestion,
  roundHalfKm,
  SESSION_KINDS,
  type SessionTone,
  volumeScale,
} from "@/lib/cobalt/plan/prescription";
import {
  formatPaceClock,
  HALF_MARATHON_KM,
  type PaceZone,
  type PredictionLockReason,
  predictRace,
  type RacePrediction,
  zonePaces,
} from "@/lib/training/prediction";

const DAY_MS = 86_400_000;

/**
 * One run a week asks for, as a line the UI can print (issue #291). `pace` is
 * null where the session has no target to hit — race day is a time, not a pace,
 * and a race week's runs exist to leave the runner fresh rather than to be
 * paced.
 */
export interface UpcomingSession {
  id: string;
  /** Danish label ("Langtur", "Kvalitetspas", "3 rolige ture"). */
  label: string;
  distanceKm: number;
  /** Target pace "m:ss" /km, or null when the session has no pace target. */
  pace: string | null;
  tone: SessionTone;
}

export interface UpcomingWeek {
  id: string;
  week: number;
  /**
   * The calendar week the row lands in, in Danish ("18.–24. aug"). Before #291
   * a row said only "Uge 13", which the runner has to count forward from the
   * header themselves.
   */
  dateLabel: string;
  focus: string;
  km: number;
  /** Down-week reads muted. */
  muted: boolean;
  /** Which week of its phase this is (1-based) — "uge 2 af 4". */
  weekInPhase: number;
  /** How many weeks the phase runs, so the UI can say "2 af 4" itself. */
  phaseTotal: number;
  /**
   * Signed volume change against the previous row, in km. Null on the first row:
   * nothing inside the window precedes it, and a hardcoded 0 would read as
   * "volume held" for a week we have no measurement of. The UI shows no delta
   * at all when this is null.
   */
  deltaKm: number | null;
  /** How many running days the week asks for — rest days are not runs. */
  runCount: number;
  sessions: UpcomingSession[];
  /** True for the week the race falls in; the UI marks the row as race week. */
  isRaceWeek: boolean;
}

/**
 * Why the race card has no numbers to show (issue #117). Present only for a live
 * runner we couldn't predict a race for — a visitor on the demo plan sees the
 * designed numbers, not a lock they can't do anything about.
 */
export interface RaceLock {
  reason: PredictionLockReason;
  /** Danish, action-directing: what the runner can do to unlock the estimate. */
  message: string;
  /**
   * The run that would unlock the estimate, in km — a quarter of the race
   * distance, so the bar scales with what the runner is training for. Absent only
   * if the predictor ever locks without naming one.
   */
  requiredKm?: number;
}

/** Timeline label per engine phase, mono uppercase in the UI. */
export const PHASE_LABELS: Record<PhaseKey, string> = {
  adapt: "Adapt",
  burn: "Burn",
  sharpen: "Sharpen",
  peak: "Peak",
  taper: "Taper",
};

/** JS weekday (0 = Sunday) → index into a Monday-first training week. */
function mondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

function startOfDayDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The Monday (local midnight) of the training week `now` falls in. */
export function startOfTrainingWeek(now: Date): Date {
  const monday = startOfDayDate(now);
  monday.setDate(monday.getDate() - mondayIndex(now.getDay()));
  return monday;
}

export function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days from `a` to `b` (local midnights — leap/DST safe). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

/**
 * The race distance the plan prescribes for. A demo plan, a visitor and any
 * legacy user who never picked a distance all resolve to the half marathon —
 * the same default the predictor already assumes, so the card can name a
 * distance instead of showing a blank (issue #291).
 */
export function raceDistanceOrHalf(km: number | null | undefined): number {
  return km != null && km > 0 ? km : HALF_MARATHON_KM;
}

/**
 * The lock a predictor result carries when it has no prediction: the reason, the
 * Danish message and the run that would unlock it (issue #117).
 */
export function lockFrom(result: ReturnType<typeof predictRace>): RaceLock {
  return {
    reason: result.reason ?? "no-runs",
    message: result.message ?? "",
    ...(result.requiredKm !== null ? { requiredKm: result.requiredKm } : {}),
  };
}

/**
 * The week's runs as printable lines (issue #291). The easy days collapse into
 * one "3 rolige ture · 26 km" line — a runner reads the *shape* of their week,
 * not seven day slots, and that is the whole point of the change — while the
 * hard efforts keep their own line, because those are the days the week is
 * actually about. `runCount` still counts every running day, so the header count
 * and the grouped line can never disagree about how much running the week holds.
 */
function buildUpcomingSessions(
  planned: PlannedSession[],
  paces: Record<PaceZone, number>,
  weekScale: number,
  isRaceWeek: boolean
): UpcomingSession[] {
  // A race week's runs carry no pace target at all: the week exists to leave the
  // runner fresh, so lending the 2 km shakeout an easy-day pace would dress a
  // deliberately short run up as a workout.
  const easyPace = isRaceWeek ? null : formatPaceClock(paces.easy);

  const hard = planned
    .filter((session) => session.type !== "rest" && session.type !== "easy")
    .map((session) => {
      const kind = SESSION_KINDS[session.type] ?? DEFAULT_SESSION_KIND;
      // Race day stays off both the week scale and the half-km grid: the scale caps
      // what the runner can absorb and has no say over how far the race is, and the
      // grid would round 21,0975 down to a "21 km" that contradicts the race card's
      // own chip. So the race line prints the real distance (issue #291).
      const distanceKm =
        session.type === "race"
          ? prescribedDistance(session, weekScale)
          : roundHalfKm(prescribedDistance(session, weekScale));
      return {
        id: session.weekday,
        label: kind.label,
        distanceKm,
        pace: kind.zone ? formatPaceClock(paces[kind.zone]) : null,
        tone: kind.tone,
      };
    });

  const easy = planned.filter((session) => session.type === "easy");
  if (easy.length === 0) return hard;

  const grouped: UpcomingSession = {
    id: "easy",
    label: easy.length === 1 ? SESSION_KINDS.easy.label : `${easy.length} rolige ture`,
    distanceKm: roundHalfKm(prescribedWeekKm(easy) * weekScale),
    pace: easyPace,
    tone: "easy",
  };
  return [...hard, grouped];
}

/**
 * The next three weeks of the build, straight off the phase engine — shared by
 * the data-driven path (runner paces + load `scale`) and the template path
 * (fallback demo paces, `scale` = 1). Both derive `focus` and `km` from the
 * phase each week actually falls in, so the widget can't go static again: the
 * phase shows through in the label, `km` is the real forecasted volume, and each
 * row carries its date span, its week-within-the-phase and its volume delta, so
 * two consecutive weeks of the same block never read identically (issue #237,
 * #291).
 */
export function derivedUpcomingWeeks(
  weekStart: Date,
  weekOfPlan: number,
  raceDate: Date,
  raceName: string,
  paces: Record<PaceZone, number>,
  scale: number,
  raceDistanceKm: number
): UpcomingWeek[] {
  const phases = buildPhases(raceDate);

  const weeks: Omit<UpcomingWeek, "deltaKm">[] = [1, 2, 3].map((offset) => {
    const start = new Date(weekStart);
    start.setDate(start.getDate() + offset * 7);
    // A week that contains race day is the taper, whatever its Monday says.
    // getCurrentPhase() only sees that Monday, and for a weekend race the Monday
    // is still the last day of peak — so the final row used to prescribe a full
    // peak week and never mention the race at all (issue #291).
    const daysToRace = daysBetween(start, raceDate);
    const isRaceWeek = daysToRace >= 0 && daysToRace <= 6;
    const phase = isRaceWeek ? "taper" : getCurrentPhase(start, raceDate);
    const planned = getWeekPlan(phase, start, raceDate, raceName, raceDistanceKm);
    // The scale converges back to the phase's full prescription as the runner
    // absorbs the load — the same 10% ceiling, one week at a time.
    const weekScale = Math.min(1, scale * MAX_WEEKLY_INCREASE_RATIO ** offset);
    // The same scale the sessions are printed with — race day exempt, see
    // `prescribedDistance` — so the row's total is the sum of the lines under it.
    const km = Math.round(prescribedWeekKm(planned, weekScale));

    // Which week of its phase this is — so a run of same-phase weeks (e.g. three
    // burn weeks) reads as a progression ("uge 2 af 3") instead of the same
    // sentence three times, and the count resetting to 1 marks a new phase.
    const phaseStart = phases[phase].startDate;
    const weekInPhase = Math.max(1, Math.floor(daysBetween(phaseStart, start) / 7) + 1);
    const phaseTotal = Math.round((daysBetween(phaseStart, phases[phase].endDate) + 1) / 7);

    const longRun = planned.find((session) => session.type === "long");
    const hasQuality = planned.some((session) => session.type === "tempo");
    const longLabel = longRun
      ? ` + lang tur ${formatDanish(roundHalfKm((longRun.distanceKm ?? 0) * weekScale), 0)} km`
      : "";
    const focus =
      phase === "taper"
        ? "Nedtrapning · rolig uge, kroppen samler op"
        : `${PHASE_LABELS[phase]} · ${
            hasQuality ? `tempo @ ${formatPaceClock(paces.tempo)} /km` : "rolig base i Zone 2"
          }${longLabel}`;

    return {
      id: `u${offset}`,
      week: weekOfPlan + offset,
      dateLabel: formatWeekSpan(start),
      focus,
      km,
      muted: phase === "taper",
      weekInPhase,
      phaseTotal,
      runCount: planned.filter((session) => session.type !== "rest").length,
      sessions: buildUpcomingSessions(planned, paces, weekScale, isRaceWeek),
      isRaceWeek,
    };
  });

  return weeks.map((week, i) => ({
    ...week,
    deltaKm: i === 0 ? null : week.km - weeks[i - 1].km,
  }));
}

/** Everything the data-driven path replaces in the view. */
export interface DerivedPlan {
  suggestions: RunSuggestion[];
  weekKm: number;
  upcomingWeeks: UpcomingWeek[];
  prediction: RacePrediction;
}

/**
 * A derived plan, or the lock that explains why there isn't one — exactly one of
 * the two, so the caller can't render a locked card and a derived plan at once.
 */
export type DerivedPlanResult = { plan: DerivedPlan; lock: null } | { plan: null; lock: RaceLock };

/**
 * Merge a goal-anchored zone grid onto a prediction-anchored one for the runner
 * who set a goal but has no observed easy pace to floor against (issue #242). The
 * easy side (recovery/easy/long) stays on the grounded prediction grid so easy
 * days can't be dragged up to an aspirational goal; the quality zones take goal
 * pace when it's the more aspirational of the two, but never fall slower than the
 * grounded ladder — so the ordering recovery > easy > long > tempo > interval
 * still holds by construction. When the goal is conservative (slower than the
 * prediction) there is nothing to protect against and the grounded ladder stands.
 */
function mergeGoalGrid(
  grounded: Record<PaceZone, number>,
  goal: Record<PaceZone, number>
): Record<PaceZone, number> {
  return {
    recovery: grounded.recovery,
    easy: grounded.easy,
    long: grounded.long,
    tempo: Math.min(grounded.tempo, goal.tempo),
    interval: Math.min(grounded.interval, goal.interval),
  };
}

/**
 * The runner's zone pace grid and the range spread to draw it with, for a
 * prediction (issue #231/#238/#242). Shared by the plan view and the coach's
 * suggestion tool so both prescribe identical targets.
 *
 * When the runner has set a goal (issue #238) the quality zones train toward goal
 * pace — goal time ÷ race distance — while the estimate itself still comes from
 * the pure prediction. The easy side must stay grounded in real fitness: #231
 * floors it on the runner's observed easy pace, but when no run carries heart
 * rate that floor is missing (issue #242) and an aspirational goal would otherwise
 * drag every easy day up. In that one case the easy side (recovery/easy/long)
 * anchors on the true prediction and goal touches only tempo/interval.
 *
 * `spread` widens the range under low confidence so the plan shows honest
 * uncertainty rather than fake precision on a target resting on one run.
 */
export function derivePaces(
  prediction: RacePrediction,
  raceDistanceKm: number | null | undefined,
  goalTimeSeconds: number | null | undefined
): { paces: Record<PaceZone, number>; spread: number } {
  const goalPaceSecPerKm =
    goalTimeSeconds != null && goalTimeSeconds > 0
      ? goalTimeSeconds / (raceDistanceKm ?? HALF_MARATHON_KM)
      : null;
  const pacePrediction: RacePrediction =
    goalPaceSecPerKm !== null
      ? { ...prediction, paceSecPerKm: Math.round(goalPaceSecPerKm) }
      : prediction;
  const paces =
    goalPaceSecPerKm !== null && prediction.observedEasyPaceSecPerKm === null
      ? mergeGoalGrid(zonePaces(prediction), zonePaces(pacePrediction))
      : zonePaces(pacePrediction);
  const spread = prediction.confidence === "low" ? LOW_CONFIDENCE_PACE_SPREAD : PACE_RANGE_SPREAD;
  return { paces, spread };
}

/**
 * This week's suggestions from the runner's own data, or a lock when we can't
 * predict a race for them — in which case the caller keeps the demo template
 * rather than prescribing paces we'd have had to invent, and the race card says
 * what the runner can do about it (issue #117).
 *
 * `hrMaxOverride` is the runner's true max heart rate (issue #116) — see
 * `getUserHrMax`. Passed straight to the predictor, which measures every
 * effort's heart rate against it.
 */
export function buildDerivedPlan(
  activities: HomeActivityLike[],
  now: Date,
  raceDate: Date,
  raceName: string,
  weekOfPlan: number,
  hrMaxOverride?: number | null,
  /**
   * The user's chosen race distance in km (issue #238) — the distance the
   * predictor targets. undefined keeps the half-marathon default (demo/visitor).
   */
  raceDistanceKm?: number | null,
  /**
   * The user's goal finish time in seconds (issue #238). When set, the week's
   * pace grid anchors on goal pace instead of the pure prediction.
   */
  goalTimeSeconds?: number | null
): DerivedPlanResult {
  const runs = activities.filter((activity) => /run/i.test(activity.type));
  const result = predictRace(runs, now, raceDistanceKm ?? undefined, hrMaxOverride);
  const prediction = result.prediction;
  if (!prediction) {
    // All three are non-null whenever `prediction` is null — the predictor's contract.
    return {
      plan: null,
      lock: lockFrom(result),
    };
  }

  const { paces, spread } = derivePaces(prediction, raceDistanceKm, goalTimeSeconds);

  const weekStart = startOfTrainingWeek(now);
  const phase = getCurrentPhase(now, raceDate);
  const raceKm = raceDistanceOrHalf(raceDistanceKm);
  const sessions = getWeekPlan(phase, weekStart, raceDate, raceName, raceKm);
  const scale = volumeScale(runs, now, prescribedWeekKm(sessions));

  return {
    plan: {
      suggestions: buildRunSuggestions(phase, paces, raceDate, spread),
      weekKm: Math.round(prescribedWeekKm(sessions) * scale),
      upcomingWeeks: derivedUpcomingWeeks(
        weekStart,
        weekOfPlan,
        raceDate,
        raceName,
        paces,
        scale,
        raceKm
      ),
      prediction,
    },
    lock: null,
  };
}
