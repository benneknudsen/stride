// Cobalt Glass — Plan view-model.
// Pure derivation (no React), mirroring lib/cobalt/hjem.ts. The live parts of the
// plan (which training week we're in, days to race, progress, the race date) come
// from the shared home view so the countdown stays in sync across pages.
//
// The week's *prescription* is data-driven for a runner with their own race
// (issue #115): the sessions come from the phase engine (`getCurrentPhase` +
// `getWeekPlan`), their volume is capped against what the runner's load ratio
// says they can absorb (`computeSnapshot` + last week's actual km), and every
// pace target is derived from the race predictor (`predictRace`) rather than
// written down. Days the runner has already run report what they actually ran.
// Demo and visitor traffic keeps the designed WEEK_TEMPLATE — fixed
// marathon-plan content where only *which* day is today derives from `now`
// (issue #96) — and so does any live user we can't predict a race for, since a
// plan with invented paces would be worse than the demo one.
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
  MAX_WEEKLY_INCREASE_RATIO,
  type PhaseKey,
  type PlannedSession,
} from "@/lib/coach/engine";
import { formatDanish } from "@/lib/cobalt/format";
import { buildHomeView, type HomeActivityLike, zoneForHeartRate } from "@/lib/cobalt/hjem";
import { demoActivities } from "@/lib/demo/data";
import { getWeeklyVolume } from "@/lib/metrics";
import {
  formatPaceClock,
  formatPaceRange,
  formatRaceTime,
  goalTimeFor,
  type PaceZone,
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

/** Colour tone for a zone/meta line — cobalt = rolig/moderat, red = hårdt. */
export type PlanTone = "cobalt" | "red" | "muted";

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

export interface DayPlan {
  id: string;
  /** Weekday label, mono uppercase (e.g. "MAN", "ONS · I DAG"). */
  dow: string;
  kind: "done" | "today" | "ai" | "rest" | "planned";
  name: string;
  /** Distance/volume prefix, e.g. "5,0 km" (omitted on rest/AI days). */
  distance?: string;
  /** Plain-language zone / description (never "Z3"). */
  zoneLabel: string;
  zoneTone: PlanTone;
  /** Bottom meta line, mono (e.g. "6:06 /km", "MÅL 5:30–5:50"). */
  meta?: string;
  metaTone: PlanTone;
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
   * True when this week's sessions, volume and pace targets were derived from
   * the runner's own data (issue #115); false when they're the demo template.
   */
  dataDriven: boolean;
  phaseMarkers: PhaseMarker[];
  phaseSegments: PhaseSegment[];
  /** Short race date for the timeline end ("20. sep"). */
  raceShortDate: string;
  weekPlannedKm: number;
  weekDoneKm: number;
  days: DayPlan[];
  upcomingWeeks: UpcomingWeek[];
  race: {
    name: string;
    /** Full race day line ("Søndag 20. september"). */
    dayLabel: string;
    /** The race date as a `<input type="date">` value ("2026-09-20"). */
    dateValue: string;
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

/** One prescribed session, before `now` decides whether it's done or ahead. */
interface DayTemplate {
  id: string;
  /** Weekday label, mono uppercase ("MAN") — "· I DAG" is appended on the day. */
  dow: string;
  /** What the day is when it isn't behind us. */
  plannedKind: Exclude<DayPlan["kind"], "done" | "today">;
  name: string;
  /** Prescribed distance in km (omitted on rest/AI days). */
  km?: number;
  zoneLabel: string;
  zoneTone: PlanTone;
  /** Meta line once the session is behind us — the pace it was run at. */
  doneMeta?: string;
  /** Meta line while it's still ahead — the target. */
  plannedMeta?: string;
  metaTone: PlanTone;
}

/** The week's prescription, Monday-first (see `mondayIndex`). */
const WEEK_TEMPLATE: DayTemplate[] = [
  {
    id: "man",
    dow: "MAN",
    plannedKind: "planned",
    name: "Recovery Jog",
    km: 5,
    zoneLabel: "Rolig snak-fart",
    zoneTone: "muted",
    doneMeta: "6:06 /km",
    plannedMeta: "MÅL 6:00–6:20",
    metaTone: "cobalt",
  },
  {
    id: "tir",
    dow: "TIR",
    plannedKind: "planned",
    name: "Tempo Tuesday",
    km: 10,
    zoneLabel: "Hårdt tempo",
    zoneTone: "red",
    doneMeta: "4:27 /km",
    plannedMeta: "MÅL 4:20–4:35",
    metaTone: "red",
  },
  {
    id: "ons",
    dow: "ONS",
    plannedKind: "planned",
    name: "Easy Run",
    km: 8,
    zoneLabel: "Rolig snak-fart",
    zoneTone: "muted",
    doneMeta: "5:41 /km",
    plannedMeta: "MÅL 5:30–5:50",
    metaTone: "cobalt",
  },
  {
    id: "tor",
    dow: "TOR",
    plannedKind: "ai",
    name: "Progressiv 10 km",
    zoneLabel: "AI-anbefalet kvalitetspas",
    zoneTone: "muted",
    doneMeta: "5:20 → 4:25",
    plannedMeta: "5:20 → 4:25",
    metaTone: "cobalt",
  },
  {
    id: "fre",
    dow: "FRE",
    plannedKind: "rest",
    name: "Hviledag",
    zoneLabel: "Restitution + mobilitet",
    zoneTone: "muted",
    metaTone: "muted",
  },
  {
    id: "lor",
    dow: "LØR",
    plannedKind: "planned",
    name: "Easy + Strides",
    km: 6,
    zoneLabel: "Rolig + 6×20 sek.",
    zoneTone: "muted",
    doneMeta: "5:38 /km",
    plannedMeta: "MÅL 5:30–5:50",
    metaTone: "cobalt",
  },
  {
    id: "son",
    dow: "SØN",
    plannedKind: "planned",
    name: "Long Run",
    km: 24,
    zoneLabel: "Moderat tempo",
    zoneTone: "muted",
    doneMeta: "5:34 /km",
    plannedMeta: "UGENS NØGLEPAS",
    metaTone: "red",
  },
];

/** JS weekday (0 = Sunday) → index into a Monday-first training week. */
function mondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

/** Weekday labels and ids for a derived week, Monday-first (the template's own). */
const DOW_LABELS = WEEK_TEMPLATE.map((day) => day.dow);
const DOW_IDS = WEEK_TEMPLATE.map((day) => day.id);

/** Session types that leave the legs needing an easy day after them. */
const HARD_TYPES = new Set(["tempo", "long", "race"]);

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

/** A day the runner has already run: everything on the card is what they actually did. */
function completedDay(index: number, runs: HomeActivityLike[], today: boolean): DayPlan {
  const distance = runs.reduce((sum, run) => sum + run.distance, 0);
  const movingTime = runs.reduce((sum, run) => sum + run.movingTime, 0);
  const km = distance / 1000;

  // HR averaged over time-in-motion, so a 90-minute long run outweighs a
  // 20-minute jog on a double day. Runs without HR simply don't vote.
  const withHr = runs.filter((run) => (run.averageHeartrate ?? 0) > 0);
  const hrSeconds = withHr.reduce((sum, run) => sum + run.movingTime, 0);
  const hr =
    hrSeconds > 0
      ? withHr.reduce((sum, run) => sum + (run.averageHeartrate ?? 0) * run.movingTime, 0) /
        hrSeconds
      : 0;
  const zone = hr > 0 ? zoneForHeartRate(hr) : null;

  return {
    id: DOW_IDS[index],
    dow: today ? `${DOW_LABELS[index]} · I DAG` : DOW_LABELS[index],
    kind: "done",
    name: runs.length === 1 ? runs[0].name : `${runs.length} ture`,
    distance: `${formatDanish(km)} km`,
    zoneLabel: zone?.label ?? "Gennemført",
    zoneTone: zone?.tone ?? "muted",
    ...(km > 0 && movingTime > 0 ? { meta: `${formatPaceClock(movingTime / km)} /km` } : {}),
    metaTone: zone && zone.level >= 4 ? "red" : "cobalt",
  };
}

/**
 * A day still ahead of the runner: the phase engine says what the session is,
 * the predictor says how fast. `sessions` is the whole week so a day can see its
 * neighbours — the easy day after a hard one is a recovery jog, and the easy day
 * before the long run carries the strides.
 */
function prescribedDay(
  index: number,
  sessions: PlannedSession[],
  paces: Record<PaceZone, number>,
  prediction: RacePrediction,
  scale: number,
  today: boolean,
  raceName: string
): DayPlan {
  const session = sessions[index];
  const dow = today ? `${DOW_LABELS[index]} · I DAG` : DOW_LABELS[index];
  const id = DOW_IDS[index];

  if (session.type === "rest") {
    return {
      id,
      dow,
      kind: "rest",
      name: "Hviledag",
      zoneLabel: "Restitution + mobilitet",
      zoneTone: "muted",
      metaTone: "muted",
    };
  }

  const km = roundHalfKm((session.distanceKm ?? 0) * scale);
  const distance = km > 0 ? { distance: `${formatDanish(km)} km` } : {};
  // The week repeats, so Monday's "yesterday" is the previous Sunday.
  const previous = sessions[(index + 6) % 7];
  const next = sessions[(index + 1) % 7];

  if (session.type === "race") {
    return {
      id,
      dow,
      kind: today ? "today" : "planned",
      name: `Race — ${raceName}`,
      ...distance,
      zoneLabel: "Race-pace",
      zoneTone: "red",
      meta: `MÅL ${formatPaceClock(prediction.paceSecPerKm)} /km`,
      metaTone: "red",
    };
  }

  if (session.type === "tempo") {
    // The week's quality session — the design's cobalt "AI-anbefalet" card.
    return {
      id,
      dow,
      kind: today ? "today" : "ai",
      name: "Tempo",
      ...distance,
      zoneLabel: "Kvalitetspas · hårdt tempo",
      zoneTone: "red",
      meta: `MÅL ${formatPaceRange(paces.tempo)}`,
      metaTone: "red",
    };
  }

  if (session.type === "long") {
    return {
      id,
      dow,
      kind: today ? "today" : "planned",
      name: "Lang tur",
      ...distance,
      zoneLabel: "Moderat tempo",
      zoneTone: "muted",
      meta: `MÅL ${formatPaceRange(paces.long)}`,
      metaTone: "red",
    };
  }

  if (HARD_TYPES.has(previous.type)) {
    return {
      id,
      dow,
      kind: today ? "today" : "planned",
      name: "Recovery Jog",
      ...distance,
      zoneLabel: "Rolig restitution",
      zoneTone: "muted",
      meta: `MÅL ${formatPaceRange(paces.recovery)}`,
      metaTone: "cobalt",
    };
  }

  if (next.type === "long") {
    return {
      id,
      dow,
      kind: today ? "today" : "planned",
      name: "Easy + Strides",
      ...distance,
      zoneLabel: `Rolig + 6×20 sek. @ ${formatPaceClock(paces.interval)}`,
      zoneTone: "muted",
      meta: `MÅL ${formatPaceRange(paces.easy)}`,
      metaTone: "cobalt",
    };
  }

  return {
    id,
    dow,
    kind: today ? "today" : "planned",
    name: "Rolig tur",
    ...distance,
    zoneLabel: "Rolig snak-fart",
    zoneTone: "muted",
    meta: `MÅL ${formatPaceRange(paces.easy)}`,
    metaTone: "cobalt",
  };
}

/** The next three weeks of the build, straight off the phase engine. */
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
          }${longLabel}`;

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
interface DerivedWeek {
  days: DayPlan[];
  weekPlannedKm: number;
  weekDoneKm: number;
  upcomingWeeks: UpcomingWeek[];
  prediction: RacePrediction;
}

/**
 * A derived week, or the lock that explains why there isn't one — exactly one of
 * the two, so the caller can't render a locked card and a derived week at once.
 */
type DerivedWeekResult = { week: DerivedWeek; lock: null } | { week: null; lock: RaceLock };

/**
 * This week from the runner's own data, or a lock when we can't predict a race
 * for them — in which case the caller keeps the demo template rather than
 * prescribing paces we'd have had to invent, and the race card says what the
 * runner can do about it (issue #117).
 *
 * `hrMaxOverride` is the runner's true max heart rate (issue #116) — see
 * `getUserHrMax`. Passed straight to the predictor, which measures every
 * effort's heart rate against it.
 */
function buildDerivedWeek(
  activities: HomeActivityLike[],
  now: Date,
  raceDate: Date,
  raceName: string,
  weekOfPlan: number,
  hrMaxOverride?: number | null
): DerivedWeekResult {
  const runs = activities.filter((activity) => /run/i.test(activity.type));
  const result = predictRace(runs, now, undefined, hrMaxOverride);
  const prediction = result.prediction;
  if (!prediction) {
    // All three are non-null whenever `prediction` is null — the predictor's contract.
    const reason = result.reason ?? "no-runs";
    const message = result.message ?? "";
    return {
      week: null,
      lock: {
        reason,
        message,
        ...(result.requiredKm !== null ? { requiredKm: result.requiredKm } : {}),
      },
    };
  }

  const paces = zonePaces(prediction);
  const weekStart = startOfTrainingWeek(now);
  const phase = getCurrentPhase(now, raceDate);
  const sessions = getWeekPlan(phase, weekStart, raceDate, raceName);
  const scale = volumeScale(runs, now, prescribedWeekKm(sessions));
  const todayIndex = mondayIndex(now.getDay());

  // Runs already logged this training week, bucketed onto their weekday. A day
  // with a run is reported, not prescribed — even if the plan called for rest.
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const runsByDay: HomeActivityLike[][] = Array.from({ length: 7 }, () => []);
  for (const run of runs) {
    if (run.startDate >= weekStart && run.startDate < weekEnd) {
      runsByDay[mondayIndex(run.startDate.getDay())].push(run);
    }
  }

  const days = sessions.map((_, index) =>
    runsByDay[index].length > 0
      ? completedDay(index, runsByDay[index], index === todayIndex)
      : prescribedDay(index, sessions, paces, prediction, scale, index === todayIndex, raceName)
  );

  return {
    week: {
      days,
      // What the plan asks of the week, against what the runner has actually run.
      weekPlannedKm: Math.round(prescribedWeekKm(sessions) * scale),
      weekDoneKm: getWeeklyVolume(runs, 0, now) / 1000,
      upcomingWeeks: derivedUpcomingWeeks(weekStart, weekOfPlan, raceDate, raceName, paces, scale),
      prediction,
    },
    lock: null,
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
   * Derive the week from `activities` instead of the demo template (issue #115).
   * The page sets this for a signed-in runner who has chosen their own race;
   * demo and visitor traffic leaves it false.
   */
  live = false,
  /**
   * The runner's true max heart rate (issue #116), from `getUserHrMax`. The
   * predictor measures each effort's HR against it; without it, it falls back to
   * the hardest average HR among the runs.
   */
  hrMax?: number | null
): PlanView {
  const home = buildHomeView(activities, now, raceDate, raceName);
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

  // The data-driven week (issue #115) — sessions from the phase engine, volume
  // from the load ratio, paces from the race predictor. Null when the runner has
  // no race of their own, no synced runs, or nothing recent enough to predict
  // from; the demo template below is the fallback in all three cases. For a live
  // runner the last two also produce a lock (issue #117): the demo template's
  // *sessions* are a reasonable stand-in, but its race numbers are not the
  // runner's, so the card shows what would unlock theirs instead.
  const derivedResult = live
    ? buildDerivedWeek(activities, now, raceDate, raceName, weekOfPlan, hrMax)
    : null;
  const derived = derivedResult?.week ?? null;
  const lock = derivedResult?.lock ?? null;

  // The template week's sessions are fixed plan content, but *which* day is
  // today is not (issue #96): a template day resolves to done/today/planned by
  // comparing its weekday to `now`. A session in the past reports the pace it
  // was run at; the same session ahead of us reports its target — so no day can
  // claim a result it hasn't produced yet.
  const todayIndex = mondayIndex(now.getDay());

  const templateDays: DayPlan[] = WEEK_TEMPLATE.map((day, index) => {
    const past = index < todayIndex;
    const today = index === todayIndex;
    // A rest day stays a rest day, whether it's behind us or ahead — there is
    // nothing to complete and nothing to prescribe.
    const kind: DayPlan["kind"] =
      day.plannedKind === "rest" ? "rest" : past ? "done" : today ? "today" : day.plannedKind;
    const meta = past ? day.doneMeta : day.plannedMeta;

    return {
      id: day.id,
      dow: today ? `${day.dow} · I DAG` : day.dow,
      kind,
      name: day.name,
      ...(day.km !== undefined ? { distance: `${formatDanish(day.km)} km` } : {}),
      zoneLabel: day.zoneLabel,
      zoneTone: day.zoneTone,
      ...(meta !== undefined ? { meta } : {}),
      metaTone: day.metaTone,
    };
  });

  // Template volume follows the same template, so the header can't promise 48 km
  // against a week that prescribes something else, nor report kilometres as run
  // on a day that hasn't happened.
  const templatePlannedKm = WEEK_TEMPLATE.reduce((sum, day) => sum + (day.km ?? 0), 0);
  const templateDoneKm = WEEK_TEMPLATE.slice(0, todayIndex).reduce(
    (sum, day) => sum + (day.km ?? 0),
    0
  );

  const templateUpcomingWeeks: UpcomingWeek[] = [
    {
      id: "u1",
      week: weekOfPlan + 1,
      focus: "Build · intervaller 8×1000 m + lang tur 26 km",
      km: 52,
      muted: false,
    },
    {
      id: "u2",
      week: weekOfPlan + 2,
      focus: "Build · marathon-pace 12 km + lang tur 28 km",
      km: 56,
      muted: false,
    },
    {
      id: "u3",
      week: weekOfPlan + 3,
      focus: "Nedtrapning · rolig uge, kroppen samler op",
      km: 38,
      muted: true,
    },
  ];

  // The race card. Live: the predictor's finish time is the AI estimate, and the
  // goal is the round number just above it — the same relationship the design
  // shows (an estimate sitting just under the goal), but computed. Demo keeps the
  // designed numbers.
  const prediction = derived?.prediction;
  const race = prediction
    ? {
        goalTime: goalTimeFor(prediction.timeSeconds),
        racePace: formatPaceClock(prediction.paceSecPerKm),
        aiEstimate: formatRaceTime(prediction.timeSeconds),
      }
    : { goalTime: "3:45", racePace: "5:20", aiEstimate: "3:41" };

  return {
    totalWeeks,
    weekOfPlan,
    daysToRace,
    // A locked card can't be headlined by the demo's goal — the runner would
    // read someone else's target as their own.
    goalLabel: prediction
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
    weekPlannedKm: derived?.weekPlannedKm ?? templatePlannedKm,
    weekDoneKm: derived?.weekDoneKm ?? templateDoneKm,
    days: derived?.days ?? templateDays,
    upcomingWeeks: derived?.upcomingWeeks ?? templateUpcomingWeeks,
    race: {
      name: raceName,
      dayLabel: raceDayLabel,
      dateValue: dateInputValue(raceDate),
      ...race,
      lock,
    },
  };
}
