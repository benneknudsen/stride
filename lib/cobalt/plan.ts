// Cobalt Glass — Plan view-model.
// Pure derivation (no React), mirroring lib/cobalt/hjem.ts. The live parts of the
// plan (which training week we're in, days to race, progress, the race date) come
// from the shared home view so the countdown stays in sync across pages. The plan
// *prescription* — this week's sessions, the upcoming block and the race targets —
// is fixed marathon-plan content, matching the design; only which of those days is
// today, and therefore which are behind us, is derived from `now` (issue #96).
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
  type PhaseKey,
} from "@/lib/coach/engine";
import { formatDanish } from "@/lib/cobalt/format";
import { buildHomeView, type HomeActivityLike } from "@/lib/cobalt/hjem";
import { demoActivities } from "@/lib/demo/data";

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

export interface PlanView {
  /** Total plan length (the serif hero: "13 uger."). */
  totalWeeks: number;
  /** Which week of the plan we're in (header stat + "Denne uge — uge N"). */
  weekOfPlan: number;
  /** Live countdown to race day. */
  daysToRace: number;
  goalLabel: string;
  /** Header label ("Træningsplan · Silkeborg Halvmarathon"). */
  planTitle: string;
  /** True once the race day is behind `now` — drives the "vælg din næste race" CTA. */
  racePassed: boolean;
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
  raceName: string = DEFAULT_RACE_NAME
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

  // The week's sessions are fixed plan content, but *which* day is today is not
  // (issue #96): a template day resolves to done/today/planned by comparing its
  // weekday to `now`. A session in the past reports the pace it was run at; the
  // same session ahead of us reports its target — so no day can claim a result
  // it hasn't produced yet.
  const todayIndex = mondayIndex(now.getDay());

  const days: DayPlan[] = WEEK_TEMPLATE.map((day, index) => {
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

  // Volume follows the same template, so the header can't promise 48 km against
  // a week that prescribes something else, nor report kilometres as run on a day
  // that hasn't happened.
  const weekPlannedKm = WEEK_TEMPLATE.reduce((sum, day) => sum + (day.km ?? 0), 0);
  const weekDoneKm = WEEK_TEMPLATE.slice(0, todayIndex).reduce(
    (sum, day) => sum + (day.km ?? 0),
    0
  );

  const upcomingWeeks: UpcomingWeek[] = [
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

  return {
    totalWeeks,
    weekOfPlan,
    daysToRace,
    goalLabel: home.plan.goalLabel,
    planTitle: home.plan.planTitle,
    racePassed: home.plan.racePassed,
    phaseMarkers,
    phaseSegments,
    raceShortDate,
    weekPlannedKm,
    weekDoneKm,
    days,
    upcomingWeeks,
    race: {
      name: raceName,
      dayLabel: raceDayLabel,
      dateValue: dateInputValue(raceDate),
      goalTime: "3:45",
      racePace: "5:20",
      aiEstimate: "3:41",
    },
  };
}
