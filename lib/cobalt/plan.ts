// Cobalt Glass — Plan view-model.
// Pure derivation (no React), mirroring lib/cobalt/hjem.ts. The live parts of the
// plan (which training week we're in, days to race, progress, the race date) come
// from the shared home view so the countdown stays in sync across pages. The plan
// *prescription* — phase timeline, this week's sessions, the upcoming block and
// the race targets — is fixed marathon-plan content, matching the design.
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
        position: daysBetween(planStart, phases[key].startDate) / planDays,
        state,
      };
    }),
    { label: `Race ${raceShortDate}`, position: 1, state: "race" as const },
  ];

  const phaseSegments: PhaseSegment[] = PHASE_SEQUENCE.map((key) => ({
    id: key,
    flex: daysBetween(phases[key].startDate, phases[key].endDate) + 1,
    fill: phaseState(key),
  }));

  const days: DayPlan[] = [
    {
      id: "man",
      dow: "MAN",
      kind: "done",
      name: "Recovery Jog",
      distance: "5,0 km",
      zoneLabel: "Rolig snak-fart",
      zoneTone: "muted",
      meta: "6:06 /km",
      metaTone: "cobalt",
    },
    {
      id: "tir",
      dow: "TIR",
      kind: "done",
      name: "Tempo Tuesday",
      distance: "10,0 km",
      zoneLabel: "Hårdt tempo",
      zoneTone: "red",
      meta: "4:27 /km",
      metaTone: "red",
    },
    {
      id: "ons",
      dow: "ONS · I DAG",
      kind: "today",
      name: "Easy Run",
      distance: "8,0 km",
      zoneLabel: "Rolig snak-fart",
      zoneTone: "muted",
      meta: "MÅL 5:30–5:50",
      metaTone: "cobalt",
    },
    {
      id: "tor",
      dow: "TOR",
      kind: "ai",
      name: "Progressiv 10 km",
      zoneLabel: "AI-anbefalet kvalitetspas",
      zoneTone: "muted",
      meta: "5:20 → 4:25",
      metaTone: "cobalt",
    },
    {
      id: "fre",
      dow: "FRE",
      kind: "rest",
      name: "Hviledag",
      zoneLabel: "Restitution + mobilitet",
      zoneTone: "muted",
      metaTone: "muted",
    },
    {
      id: "lor",
      dow: "LØR",
      kind: "planned",
      name: "Easy + Strides",
      distance: "6,0 km",
      zoneLabel: "Rolig + 6×20 sek.",
      zoneTone: "muted",
      meta: "MÅL 5:30–5:50",
      metaTone: "cobalt",
    },
    {
      id: "son",
      dow: "SØN",
      kind: "planned",
      name: "Long Run",
      distance: "24,0 km",
      zoneLabel: "Moderat tempo",
      zoneTone: "muted",
      meta: "UGENS NØGLEPAS",
      metaTone: "red",
    },
  ];

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
    weekPlannedKm: 48,
    weekDoneKm: 23.2,
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
