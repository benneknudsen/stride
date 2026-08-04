// Cobalt Glass — Plan view-model.
// Pure derivation (no React), mirroring lib/cobalt/hjem.ts. The live parts of the
// plan (which training week we're in, days to race, progress, the race date) come
// from the shared home view so the countdown stays in sync across pages.
//
// The plan no longer prescribes a Mon–Sun schedule (issue #244). Instead it
// surfaces three phase-aware *run suggestions* — an easy run, a quality run and a
// long run — with the distance each carries in the current phase and the pace
// target for it. They are day-agnostic: the plan says what kinds of runs the week
// asks for, and the coach (`lib/coach/recommender.ts`) reads them to recommend
// which one to do today against the runner's readiness and recovery buffer.
//
// The suggestions are still data-driven for a runner with their own race (issue
// #115): the distances come from the phase engine (`getPhaseRules`), their total
// volume from `getWeekPlan` capped against what the runner's load ratio says they
// can absorb (`computeSnapshot` + last week's actual km), and every pace target is
// derived from the race predictor (`predictRace` → `zonePaces`) rather than
// written down. Demo and visitor traffic — and any live user we can't predict a
// race for — keep the same phase-engine distances with fallback demo paces, since
// a plan with invented paces would be worse than the demo one.
//
// buildPlanView() defaults to the demo fixtures (the unauthenticated fallback);
// the server page passes getDashboardActivities rows for signed-in users
// (issue #84), so the live parts derive from real training data. The race is a
// parameter too (issue #99): phase markers/segments, the countdown and the race
// card all derive from buildPhases(raceDate), so a user's own race re-anchors
// the whole page while the defaults keep visitors on the demo plan.

import {
  buildPhases,
  DEFAULT_RACE_DATE,
  DEFAULT_RACE_NAME,
  getCurrentPhase,
  getPhaseRules,
  getWeekPlan,
  MAX_WEEKLY_INCREASE_RATIO,
  type PhaseKey,
  type PlannedSession,
} from "@/lib/coach/engine";
import { formatDanish } from "@/lib/cobalt/format";
import { buildHomeView, type HomeActivityLike } from "@/lib/cobalt/hjem";
// The goal display reuses race-estimate's clock format (h:mm above the hour,
// m:ss below), so a 10K goal reads "50:00" rather than "0:50" (issue #238).
import { formatRaceTime as formatGoalClock } from "@/lib/cobalt/race-estimate";
import { demoActivities } from "@/lib/demo/data";
import { getWeeklyVolume } from "@/lib/metrics";
import {
  formatPaceClock,
  formatRaceTime,
  goalTimeFor,
  HALF_MARATHON_KM,
  type PaceZone,
  type PredictionActivity,
  type PredictionLockReason,
  predictRace,
  type RacePrediction,
  zonePaces,
} from "@/lib/training/prediction";
import { computeSnapshot } from "@/lib/training/progression-core";

const DA_WEEKDAYS = ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"];
const DA_MONTHS_SHORT = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];
const DA_MONTHS_LONG = [
  "januar",
  "februar",
  "marts",
  "april",
  "maj",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "december",
];

/** The three run types the plan suggests each week (issue #244). */
export type SuggestionType = "easy" | "tempo" | "long";

/**
 * One of the week's three run suggestions (issue #244). Day-agnostic: it names a
 * kind of run, its phase distance and its pace target, but never *which* day —
 * the coach decides that. `min`/`max` are the pace range's fast/slow ends,
 * already formatted ("8:10"/"8:30").
 */
export interface RunSuggestion {
  type: SuggestionType;
  /** Danish label, mono uppercase in the UI ("Let pas" / "Kvalitetspas" / "Langtur"). */
  label: string;
  /** Distance in km, from the phase rules (`getPhaseRules`). */
  distanceKm: number;
  /** Target pace range, min (fast) → max (slow), formatted "m:ss". */
  paceRange: { min: string; max: string };
  /** Plain-language description ("Rolig restitution" / "Tempo · hårdt" / "Lang tur · moderat"). */
  description: string;
}

export interface PhaseMarker {
  /** Label, mono uppercase (e.g. "Base", "Build · nu", "Race 20. sep"). */
  label: string;
  /** Same label trimmed for narrow viewports (e.g. "Race" — six labels fit 375px). */
  shortLabel: string;
  /** Where the dot sits on the timeline, 0–1 left→right. */
  position: number;
  state: "done" | "active" | "upcoming" | "race";
}

export interface PhaseSegment {
  /** Stable key (phase name). */
  id: string;
  /** Flex weight of the segment (proportional width). */
  flex: number;
  /** "done" = solid cobalt, "active" = half-filled gradient, "upcoming" = muted. */
  fill: "done" | "active" | "upcoming";
}

export interface UpcomingWeek {
  id: string;
  week: number;
  focus: string;
  km: number;
  /** Down-week reads muted. */
  muted: boolean;
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

export interface PlanView {
  /** Total plan length (the serif hero: "13 uger."). */
  totalWeeks: number;
  /** Which week of the plan we're in (header stat + "Denne uge — uge N"). */
  weekOfPlan: number;
  /** Live countdown to race day. */
  daysToRace: number;
  /**
   * The headline goal ("Mål under 1:55"). Null when there's nothing to derive it
   * from — no prediction, no lock, and no goal on the home view — and the header
   * falls back to a neutral headline rather than inventing a target.
   */
  goalLabel: string | null;
  /** Header label ("Træningsplan · Silkeborg Halvmarathon"). */
  planTitle: string;
  /** True once the race day is behind `now` — drives the "vælg din næste race" CTA. */
  racePassed: boolean;
  /**
   * True when this week's suggestions, volume and pace targets were derived from
   * the runner's own data (issue #115); false when they're the demo template.
   */
  dataDriven: boolean;
  phaseMarkers: PhaseMarker[];
  phaseSegments: PhaseSegment[];
  /** Short race date for the timeline end ("20. sep"). */
  raceShortDate: string;
  /** The current training phase's label ("Burn"), for the "· Burn-fase" header (issue #244). */
  phaseLabel: string;
  /** The three phase-aware run suggestions (easy / quality / long) — issue #244. */
  suggestions: RunSuggestion[];
  /** Total suggested weekly volume in km (the "18 km foreslået" overview). */
  weekKm: number;
  upcomingWeeks: UpcomingWeek[];
  race: {
    name: string;
    /** Full race day line ("Søndag 20. september"). */
    dayLabel: string;
    /** The race date as a `<input type="date">` value ("2026-09-20"). */
    dateValue: string;
    /**
     * The user's chosen race distance in km (issue #238), or null when they
     * haven't picked one (demo/visitor/legacy) — the dialog then defaults it.
     */
    distanceKm: number | null;
    /**
     * The user's goal finish time in seconds (issue #238), or null when no goal
     * is set — the dialog prefills the goal field from it.
     */
    goalTimeSeconds: number | null;
    goalTime: string;
    racePace: string;
    aiEstimate: string;
    /**
     * Set when the estimate is locked (issue #117): the goal/pace/estimate above
     * are placeholders the card must not show, and this says what would unlock
     * them instead. Null whenever there's a real prediction — or a demo plan,
     * whose numbers are designed rather than derived.
     */
    lock: RaceLock | null;
  };
}

/** Timeline label per engine phase, mono uppercase in the UI. */
const PHASE_LABELS: Record<PhaseKey, string> = {
  adapt: "Adapt",
  burn: "Burn",
  sharpen: "Sharpen",
  peak: "Peak",
  taper: "Taper",
};

const PHASE_SEQUENCE: PhaseKey[] = ["adapt", "burn", "sharpen", "peak", "taper"];

const DAY_MS = 86_400_000;

/** JS weekday (0 = Sunday) → index into a Monday-first training week. */
function mondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

/**
 * Half-width of a pace-target range when the prediction is low-confidence (issue
 * #231) — wider than the default so the plan shows honest uncertainty rather than
 * fake precision on a target it rests one run on.
 */
const LOW_CONFIDENCE_PACE_SPREAD = 25;

/** Default half-width of a pace-target range, in seconds ("MÅL 8:10–8:30"). */
const PACE_RANGE_SPREAD = 10;

/**
 * Fallback training paces (seconds per km) for the template path — demo,
 * visitors, and any live runner we can't predict a race for (issue #117). That
 * path has no race predictor and so no runner paces. These stand-in paces let the
 * same phase-engine forecast run there too, so the suggestions and upcoming weeks
 * still read phase-correctly without inventing per-user targets. Derived from the
 * demo athlete's own recent efforts (`lib/demo/data.ts`) and hand-aligned to the
 * pace grid — deterministic, so server render and client hydration agree.
 */
const FALLBACK_PACES: Record<PaceZone, number> = {
  recovery: 365,
  easy: 345,
  long: 330,
  tempo: 285,
  interval: 270,
};

/** Targets are prescribed on a half-km grid — "7,5 km", never "7,4 km". */
function roundHalfKm(km: number): number {
  return Math.round(km * 2) / 2;
}

function startOfDayDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The Monday (local midnight) of the training week `now` falls in. */
function startOfTrainingWeek(now: Date): Date {
  const monday = startOfDayDate(now);
  monday.setDate(monday.getDate() - mondayIndex(now.getDay()));
  return monday;
}

/**
 * How much of the phase's prescription the runner can actually absorb this week.
 * Never scales *up* — the phase rules are the ceiling — and never asks for more
 * than {@link MAX_WEEKLY_INCREASE_RATIO} on top of last week's real volume, with
 * the load ratio (`computeSnapshot`) tightening that further when the acute:chronic
 * band says the runner is already carrying too much.
 */
function volumeScale(runs: HomeActivityLike[], now: Date, prescribedKm: number): number {
  if (prescribedKm <= 0) return 1;
  const lastWeekKm = getWeeklyVolume(runs, 1, now) / 1000;
  if (lastWeekKm <= 0) return 1;

  const risk = computeSnapshot(
    runs.map((run) => ({ ...run, hrZones: null })),
    now
  ).trainingLoad.risk;
  const growthCap = risk === "high" ? 0.9 : risk === "elevated" ? 1 : MAX_WEEKLY_INCREASE_RATIO;

  const targetKm = Math.min(prescribedKm, lastWeekKm * growthCap);
  // Floored: a single missed week shouldn't collapse the plan to nothing.
  return Math.max(0.6, Math.min(1, targetKm / prescribedKm));
}

/** Total prescribed distance across a generated week. */
function prescribedWeekKm(sessions: PlannedSession[]): number {
  return sessions.reduce((sum, session) => sum + (session.distanceKm ?? 0), 0);
}

/** A pace (seconds/km) as a fast→slow range around its centre, formatted "m:ss". */
function paceRangeOf(secondsPerKm: number, spread: number): { min: string; max: string } {
  return {
    min: formatPaceClock(secondsPerKm - spread),
    max: formatPaceClock(secondsPerKm + spread),
  };
}

/**
 * The week's three run suggestions for a phase (issue #244). Distances come from
 * the phase rules — the same numbers `getWeekPlan` assigns to weekdays, but pulled
 * out per run *type* instead of per day: the easy run sits at the phase's mid
 * distance, the quality run at its session ceiling (`maxDistanceKm`), the long run
 * at its long-run ceiling (`longRunMaxKm`). Paces come from the zone grid
 * (`zonePaces`), so recovery/easy → easy target, tempo → quality target, long →
 * long target. `spread` widens the range under low confidence (issue #231).
 */
export function buildRunSuggestions(
  phase: PhaseKey,
  paces: Record<PaceZone, number>,
  raceDate: Date = DEFAULT_RACE_DATE,
  spread: number = PACE_RANGE_SPREAD
): RunSuggestion[] {
  const rules = getPhaseRules(phase, raceDate);
  const easyKm = roundHalfKm((rules.minDistanceKm + rules.maxDistanceKm) / 2);
  return [
    {
      type: "easy",
      label: "Let pas",
      distanceKm: easyKm,
      paceRange: paceRangeOf(paces.easy, spread),
      description: "Rolig restitution",
    },
    {
      type: "tempo",
      label: "Kvalitetspas",
      distanceKm: rules.maxDistanceKm,
      paceRange: paceRangeOf(paces.tempo, spread),
      description: "Tempo · hårdt",
    },
    {
      type: "long",
      label: "Langtur",
      distanceKm: rules.longRunMaxKm,
      paceRange: paceRangeOf(paces.long, spread),
      description: "Lang tur · moderat",
    },
  ];
}

/**
 * The next three weeks of the build, straight off the phase engine — shared by
 * the data-driven path (runner paces + load `scale`) and the template path
 * (fallback demo paces, `scale` = 1). Both derive `focus` and `km` from the
 * phase each week actually falls in, so the widget can't go static again: the
 * phase shows through in the label, `km` is the real forecasted volume, and each
 * row carries its week-within-the-phase so two consecutive weeks of the same
 * block never read identically (issue #237).
 */
function derivedUpcomingWeeks(
  weekStart: Date,
  weekOfPlan: number,
  raceDate: Date,
  raceName: string,
  paces: Record<PaceZone, number>,
  scale: number
): UpcomingWeek[] {
  return [1, 2, 3].map((offset) => {
    const start = new Date(weekStart);
    start.setDate(start.getDate() + offset * 7);
    const phase = getCurrentPhase(start, raceDate);
    const sessions = getWeekPlan(phase, start, raceDate, raceName);
    // The scale converges back to the phase's full prescription as the runner
    // absorbs the load — the same 10% ceiling, one week at a time.
    const weekScale = Math.min(1, scale * MAX_WEEKLY_INCREASE_RATIO ** offset);
    const km = Math.round(prescribedWeekKm(sessions) * weekScale);

    // Which week of its phase this is — so a run of same-phase weeks (e.g. three
    // burn weeks) reads as a progression ("uge 1/2/3 i blokken") instead of the
    // same sentence three times, and the count resetting to 1 marks a new phase.
    const phaseStart = buildPhases(raceDate)[phase].startDate;
    const weekInPhase = Math.max(1, Math.floor(daysBetween(phaseStart, start) / 7) + 1);

    const longRun = sessions.find((session) => session.type === "long");
    const hasQuality = sessions.some((session) => session.type === "tempo");
    const longLabel = longRun
      ? ` + lang tur ${formatDanish(roundHalfKm((longRun.distanceKm ?? 0) * weekScale), 0)} km`
      : "";
    const focus =
      phase === "taper"
        ? "Nedtrapning · rolig uge, kroppen samler op"
        : `${PHASE_LABELS[phase]} · ${
            hasQuality ? `tempo @ ${formatPaceClock(paces.tempo)} /km` : "rolig base i Zone 2"
          }${longLabel} · uge ${weekInPhase} i blokken`;

    return {
      id: `u${offset}`,
      week: weekOfPlan + offset,
      focus,
      km,
      muted: phase === "taper",
    };
  });
}

/** Everything the data-driven path replaces in the view. */
interface DerivedPlan {
  suggestions: RunSuggestion[];
  weekKm: number;
  upcomingWeeks: UpcomingWeek[];
  prediction: RacePrediction;
}

/**
 * A derived plan, or the lock that explains why there isn't one — exactly one of
 * the two, so the caller can't render a locked card and a derived plan at once.
 */
type DerivedPlanResult = { plan: DerivedPlan; lock: null } | { plan: null; lock: RaceLock };

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
function derivePaces(
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
function buildDerivedPlan(
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
    const reason = result.reason ?? "no-runs";
    const message = result.message ?? "";
    return {
      plan: null,
      lock: {
        reason,
        message,
        ...(result.requiredKm !== null ? { requiredKm: result.requiredKm } : {}),
      },
    };
  }

  const { paces, spread } = derivePaces(prediction, raceDistanceKm, goalTimeSeconds);

  const weekStart = startOfTrainingWeek(now);
  const phase = getCurrentPhase(now, raceDate);
  const sessions = getWeekPlan(phase, weekStart, raceDate, raceName);
  const scale = volumeScale(runs, now, prescribedWeekKm(sessions));

  return {
    plan: {
      suggestions: buildRunSuggestions(phase, paces, raceDate, spread),
      weekKm: Math.round(prescribedWeekKm(sessions) * scale),
      upcomingWeeks: derivedUpcomingWeeks(weekStart, weekOfPlan, raceDate, raceName, paces, scale),
      prediction,
    },
    lock: null,
  };
}

/**
 * The three run suggestions the coach reads to recommend today's run (issue
 * #244) — the same easy/quality/long suggestions the plan page shows, resolved
 * for the coach's tool layer straight from the runner's activities. Paces derive
 * from the race predictor when there's enough to predict from, and fall back to
 * the demo grid otherwise (`dataDriven` says which). The coach pairs these with
 * its own recovery buffer to say *which* one to do — the plan never prescribes a
 * day.
 */
export interface PlanSuggestions {
  phase: PhaseKey;
  /** The phase's label ("Burn"), for prose. */
  phaseLabel: string;
  /** Total suggested weekly volume in km, from the phase rules. */
  weekKm: number;
  suggestions: RunSuggestion[];
  /** True when paces came from the runner's own prediction; false = fallback grid. */
  dataDriven: boolean;
}

export function getPlanSuggestions(
  activities: PredictionActivity[],
  now: Date,
  raceDate: Date = DEFAULT_RACE_DATE,
  raceName: string = DEFAULT_RACE_NAME,
  raceDistanceKm?: number | null,
  hrMax?: number | null,
  goalTimeSeconds?: number | null
): PlanSuggestions {
  const phase = getCurrentPhase(now, raceDate);
  const sessions = getWeekPlan(phase, startOfTrainingWeek(now), raceDate, raceName);
  const weekKm = Math.round(prescribedWeekKm(sessions));

  const runs = activities.filter((activity) => /run/i.test(activity.type));
  const prediction = predictRace(runs, now, raceDistanceKm ?? undefined, hrMax).prediction;
  const { paces, spread } = prediction
    ? derivePaces(prediction, raceDistanceKm, goalTimeSeconds)
    : { paces: FALLBACK_PACES, spread: PACE_RANGE_SPREAD };

  return {
    phase,
    phaseLabel: PHASE_LABELS[phase],
    weekKm,
    suggestions: buildRunSuggestions(phase, paces, raceDate, spread),
    dataDriven: prediction !== null,
  };
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days from `a` to `b` (local midnights — leap/DST safe). */
function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

/** "2026-09-20" — the value a native date input expects, from local Y/M/D. */
function dateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function buildPlanView(
  activities: HomeActivityLike[] = demoActivities,
  now: Date = new Date(),
  raceDate: Date = DEFAULT_RACE_DATE,
  raceName: string = DEFAULT_RACE_NAME,
  /**
   * Derive the suggestions from `activities` instead of the demo template (issue
   * #115). The page sets this for a signed-in runner who has chosen their own
   * race; demo and visitor traffic leaves it false.
   */
  live = false,
  /**
   * The runner's true max heart rate (issue #116), from `getUserHrMax`. The
   * predictor measures each effort's HR against it; without it, it falls back to
   * the hardest average HR among the runs.
   */
  hrMax?: number | null,
  /**
   * The user's chosen race distance in km (issue #238). Threads to the predictor
   * (which targets it) and prefills the dialog. undefined keeps today's
   * half-marathon default for demo/visitor traffic.
   */
  raceDistanceKm?: number | null,
  /**
   * The user's goal finish time in seconds (issue #238). When set, the header
   * and race card show the goal (and goal pace) instead of the prediction, and
   * the week's pace grid anchors on goal pace.
   */
  goalTimeSeconds?: number | null
): PlanView {
  const home = buildHomeView(activities, now, raceDate, raceName, raceDistanceKm, goalTimeSeconds);
  const weekOfPlan = home.plan.weekOfPlan;
  const totalWeeks = home.plan.totalWeeks;
  const daysToRace = home.plan.daysToRace;

  const raceShortDate = `${raceDate.getDate()}. ${DA_MONTHS_SHORT[raceDate.getMonth()]}`;
  const raceDayLabel = `${DA_WEEKDAYS[raceDate.getDay()]} ${raceDate.getDate()}. ${DA_MONTHS_LONG[raceDate.getMonth()]}`;

  // Timeline derived from the engine's phase blocks (issue #99, closes #96 pt 1):
  // each phase's position is its boundary's share of the whole build, and its
  // state/fill follows where `now` sits — so the timeline can never contradict
  // the header's weekOfPlan again.
  const phases = buildPhases(raceDate);
  const planStart = phases.adapt.startDate;
  const planDays = daysBetween(planStart, phases.taper.endDate);
  const nowDay = startOfDay(now);

  const phaseState = (phase: PhaseKey): "done" | "active" | "upcoming" => {
    if (nowDay > startOfDay(phases[phase].endDate)) return "done";
    if (nowDay >= startOfDay(phases[phase].startDate)) return "active";
    return "upcoming";
  };

  const phaseMarkers: PhaseMarker[] = [
    ...PHASE_SEQUENCE.map((key) => {
      const state = phaseState(key);
      const suffix = state === "done" ? " ✓" : state === "active" ? " · nu" : "";
      return {
        label: `${PHASE_LABELS[key]}${suffix}`,
        shortLabel: PHASE_LABELS[key],
        position: daysBetween(planStart, phases[key].startDate) / planDays,
        state,
      };
    }),
    {
      label: `Race ${raceShortDate}`,
      shortLabel: "Race",
      position: 1,
      state: "race" as const,
    },
  ];

  const phaseSegments: PhaseSegment[] = PHASE_SEQUENCE.map((key) => ({
    id: key,
    flex: daysBetween(phases[key].startDate, phases[key].endDate) + 1,
    fill: phaseState(key),
  }));

  // The current training phase — drives the "· Burn-fase" header label and, on
  // the template path, the distances the suggestions carry.
  const phase = getCurrentPhase(now, raceDate);

  // The data-driven suggestions (issue #115) — distances from the phase engine,
  // volume from the load ratio, paces from the race predictor. Null when the
  // runner has no race of their own, no synced runs, or nothing recent enough to
  // predict from; the demo template below is the fallback in all three cases. For
  // a live runner the last two also produce a lock (issue #117): the template's
  // *distances* are a reasonable stand-in, but its race numbers are not the
  // runner's, so the card shows what would unlock theirs instead.
  const derivedResult = live
    ? buildDerivedPlan(
        activities,
        now,
        raceDate,
        raceName,
        weekOfPlan,
        hrMax,
        raceDistanceKm,
        goalTimeSeconds
      )
    : null;
  const derived = derivedResult?.plan ?? null;
  const lock = derivedResult?.lock ?? null;

  // The template path (demo, visitors, and any live runner we couldn't predict a
  // race for — issue #117) has no runner data to derive paces or load from, so it
  // runs the same phase-engine forecast with fallback demo paces and no load
  // scaling. This keeps the suggestions and "Kommende uger" phase-correct in every
  // state — a taper reads as a taper, a base week as a base week.
  const weekStart = startOfTrainingWeek(now);
  const templateSessions = getWeekPlan(phase, weekStart, raceDate, raceName);
  const templateSuggestions = buildRunSuggestions(phase, FALLBACK_PACES, raceDate);
  const templateWeekKm = Math.round(prescribedWeekKm(templateSessions));
  const templateUpcomingWeeks = derivedUpcomingWeeks(
    weekStart,
    weekOfPlan,
    raceDate,
    raceName,
    FALLBACK_PACES,
    1
  );

  // The race card. Live: the predictor's finish time is the AI estimate, and the
  // goal is the round number just above it — the same relationship the design
  // shows (an estimate sitting just under the goal), but computed. Demo keeps the
  // designed numbers.
  //
  // When the runner has set their own goal (issue #238), it takes over the goal
  // time and race pace: "Måltid" shows their target, "Race-pace" shows goal pace
  // (goal time ÷ distance), and "AI-estimat" still shows the model's prediction —
  // so the card contrasts what they're aiming for with what the model expects.
  const prediction = derived?.prediction;
  const hasGoal = goalTimeSeconds != null && goalTimeSeconds > 0;
  const goalDistanceKm =
    raceDistanceKm != null && raceDistanceKm > 0 ? raceDistanceKm : HALF_MARATHON_KM;
  const goalRacePace = hasGoal ? formatPaceClock(goalTimeSeconds / goalDistanceKm) : null;
  const race = prediction
    ? {
        goalTime: hasGoal ? formatGoalClock(goalTimeSeconds) : goalTimeFor(prediction.timeSeconds),
        racePace: goalRacePace ?? formatPaceClock(prediction.paceSecPerKm),
        aiEstimate: formatRaceTime(prediction.timeSeconds),
      }
    : { goalTime: "3:45", racePace: "5:20", aiEstimate: "3:41" };

  return {
    totalWeeks,
    weekOfPlan,
    daysToRace,
    // The runner's own goal is the headline when they've set one; otherwise the
    // prediction-derived target. A locked card can't be headlined by the demo's
    // goal — the runner would read someone else's target as their own.
    goalLabel: hasGoal
      ? `Mål under ${formatGoalClock(goalTimeSeconds)}`
      : prediction
        ? `Mål under ${race.goalTime}`
        : lock
          ? "Mål på vej"
          : home.plan.goalLabel,
    planTitle: home.plan.planTitle,
    racePassed: home.plan.racePassed,
    dataDriven: derived !== null,
    phaseMarkers,
    phaseSegments,
    raceShortDate,
    phaseLabel: PHASE_LABELS[phase],
    suggestions: derived?.suggestions ?? templateSuggestions,
    weekKm: derived?.weekKm ?? templateWeekKm,
    upcomingWeeks: derived?.upcomingWeeks ?? templateUpcomingWeeks,
    race: {
      name: raceName,
      dayLabel: raceDayLabel,
      dateValue: dateInputValue(raceDate),
      distanceKm: raceDistanceKm ?? null,
      goalTimeSeconds: goalTimeSeconds ?? null,
      ...race,
      lock,
    },
  };
}
