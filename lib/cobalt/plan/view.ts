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
  getWeekPlan,
  type PhaseKey,
} from "@/lib/coach/engine";
import {
  DA_MONTHS_LONG,
  DA_MONTHS_SHORT,
  DA_WEEKDAYS,
  formatDistanceKm,
  raceDistanceLabel,
} from "@/lib/cobalt/format";
import { buildHomeView, type HomeActivityLike } from "@/lib/cobalt/hjem";
import {
  buildRunSuggestions,
  PACE_RANGE_SPREAD,
  prescribedWeekKm,
  type RunSuggestion,
} from "@/lib/cobalt/plan/prescription";
import { buildScenarios, type RaceScenario } from "@/lib/cobalt/plan/scenarios";
import {
  buildDerivedPlan,
  daysBetween,
  derivedUpcomingWeeks,
  derivePaces,
  PHASE_LABELS,
  type RaceLock,
  raceDistanceOrHalf,
  startOfDay,
  startOfTrainingWeek,
  type UpcomingWeek,
} from "@/lib/cobalt/plan/upcoming";
// The app's clock for a time (h:mm above the hour, m:ss below), so a 10K goal
// reads "50:00" rather than "0:50" (issue #238). The race card's goal and the
// what-if card's projection both speak it, so a goal and a projection never look
// like two different kinds of number.
import { formatRaceTime as formatClock } from "@/lib/cobalt/race-estimate";
import { demoActivities } from "@/lib/demo/data";
import {
  formatPaceClock,
  formatRaceTime,
  goalTimeFor,
  type PaceZone,
  type PredictionActivity,
  predictRace,
} from "@/lib/training/prediction";

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
  /**
   * The "hvad hvis" scenarios (issue #340) — what the runner's current basis
   * reaches at each of the four standard distances. Empty on the demo plan: the
   * demo athlete's times are not the runner's (issue #117).
   */
  scenarios: RaceScenario[];
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
     * The distance as a name ("Halvmarathon", "10K", "12,5 km"). `raceDistanceKm`
     * drives pace and prediction, but the card never said which distance those
     * numbers were for — these three labels are how it says it now (issue #291).
     */
    distanceLabel: string;
    /** The same name mid-sentence, Danish words lowercased ("halvmaraton"). */
    distanceInline: string;
    /** The distance as a figure ("21,1 km"), for beside the name. */
    distanceKmLabel: string;
    /**
     * The user's goal finish time in seconds (issue #238), or null when no goal
     * is set — the dialog prefills the goal field from it.
     */
    goalTimeSeconds: number | null;
    goalTime: string;
    racePace: string;
    estimate: string;
    /**
     * Set when the estimate is locked (issue #117): the goal/pace/estimate above
     * are placeholders the card must not show, and this says what would unlock
     * them instead. Null whenever there's a real prediction — or a demo plan,
     * whose numbers are designed rather than derived.
     */
    lock: RaceLock | null;
  };
}

const PHASE_SEQUENCE: PhaseKey[] = ["adapt", "burn", "sharpen", "peak", "taper"];

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

/**
 * The three run suggestions the coach reads to recommend today's run (issue
 * #244) — the same easy/quality/long suggestions the plan page shows, resolved
 * for the coach's tool layer straight from the runner's activities. Paces derive
 * from the race predictor when there's enough to predict from, and fall back to
 * the demo grid otherwise (`dataDriven` says which). The coach pairs these with
 * its own recovery buffer to say *which* one to do — the plan never prescribes a
 * day.
 */
interface PlanSuggestions {
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
  const sessions = getWeekPlan(
    phase,
    startOfTrainingWeek(now),
    raceDate,
    raceName,
    raceDistanceOrHalf(raceDistanceKm)
  );
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

  // The "hvad hvis" scenarios (issue #340) — the predictor pointed at each of the
  // four standard distances. Only a runner with a race of their own gets them:
  // the projections come from their own runs, and on the demo plan they would be
  // the demo athlete's times wearing the runner's name (issue #117). A live
  // runner we can't predict for still gets them — locked, per distance, so the
  // card can say what would unlock each one.
  const scenarios = live
    ? buildScenarios(activities, now, hrMax, raceDistanceKm, goalTimeSeconds)
    : [];

  // The template path (demo, visitors, and any live runner we couldn't predict a
  // race for — issue #117) has no runner data to derive paces or load from, so it
  // runs the same phase-engine forecast with fallback demo paces and no load
  // scaling. This keeps the suggestions and "Kommende uger" phase-correct in every
  // state — a taper reads as a taper, a base week as a base week.
  const weekStart = startOfTrainingWeek(now);
  const cardDistanceKm = raceDistanceOrHalf(raceDistanceKm);
  const templateSessions = getWeekPlan(phase, weekStart, raceDate, raceName, cardDistanceKm);
  const templateSuggestions = buildRunSuggestions(phase, FALLBACK_PACES, raceDate);
  const templateWeekKm = Math.round(prescribedWeekKm(templateSessions));
  const templateUpcomingWeeks = derivedUpcomingWeeks(
    weekStart,
    weekOfPlan,
    raceDate,
    raceName,
    FALLBACK_PACES,
    1,
    cardDistanceKm
  );

  // The race card. Live: the Riegel predictor's finish time is the estimate, and
  // the goal is the round number just above it — the same relationship the design
  // shows (an estimate sitting just under the goal), but computed. Demo keeps the
  // designed numbers.
  //
  // When the runner has set their own goal (issue #238), it takes over the goal
  // time and race pace: "Måltid" shows their target, "Race-pace" shows goal pace
  // (goal time ÷ distance), and "Prognose" still shows the predictor's read —
  // so the card contrasts what they're aiming for with what the history says.
  const prediction = derived?.prediction;
  const hasGoal = goalTimeSeconds != null && goalTimeSeconds > 0;
  const goalRacePace = hasGoal ? formatPaceClock(goalTimeSeconds / cardDistanceKm) : null;
  // The distance the card's numbers are for, named three ways: on the card chip,
  // in the header's headline, and as the plain figure beside the name. All three
  // fall back to the half marathon, so a demo plan and a legacy user get a real
  // distance rather than a blank where the distance should be (issue #291).
  const distanceNames = raceDistanceLabel(cardDistanceKm);
  const race = prediction
    ? {
        goalTime: hasGoal ? formatClock(goalTimeSeconds) : goalTimeFor(prediction.timeSeconds),
        racePace: goalRacePace ?? formatPaceClock(prediction.paceSecPerKm),
        estimate: formatRaceTime(prediction.timeSeconds),
      }
    : { goalTime: "3:45", racePace: "5:20", estimate: "3:41" };

  return {
    totalWeeks,
    weekOfPlan,
    daysToRace,
    // The runner's own goal is the headline when they've set one; otherwise the
    // prediction-derived target. A locked card can't be headlined by the demo's
    // goal — the runner would read someone else's target as their own.
    goalLabel: hasGoal
      ? `Mål under ${formatClock(goalTimeSeconds)}`
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
    scenarios,
    race: {
      name: raceName,
      dayLabel: raceDayLabel,
      dateValue: dateInputValue(raceDate),
      distanceKm: raceDistanceKm ?? null,
      distanceLabel: distanceNames.label,
      distanceInline: distanceNames.inline,
      // One formatter for the whole plan, so the figure beside the name is the
      // same string the name itself fell back to ("14 km", not "14,0 km · 14 km").
      distanceKmLabel: formatDistanceKm(cardDistanceKm),
      goalTimeSeconds: goalTimeSeconds ?? null,
      ...race,
      lock,
    },
  };
}
