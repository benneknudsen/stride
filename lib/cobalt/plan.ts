// Cobalt Glass — Plan view-model.
// Pure derivation (no React), mirroring lib/cobalt/hjem.ts. The live parts of the
// plan (which training week we're in, days to race, progress, the race date) come
// from the shared home view so the countdown stays in sync across pages. The plan
// *prescription* — phase timeline, this week's sessions, the upcoming block and
// the race targets — is fixed marathon-plan content, matching the design.

import { buildHomeView, RACE_DATE } from "@/lib/cobalt/hjem";

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
  /** Label, mono uppercase (e.g. "Base", "Build · nu", "Race 13. sep"). */
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
  /** Total plan length (the serif hero: "38 uger."). */
  totalWeeks: number;
  /** Which week of the plan we're in (header stat + "Denne uge — uge N"). */
  weekOfPlan: number;
  /** Live countdown to race day. */
  daysToRace: number;
  goalLabel: string;
  phaseMarkers: PhaseMarker[];
  phaseSegments: PhaseSegment[];
  /** Short race date for the timeline end ("13. sep"). */
  raceShortDate: string;
  weekPlannedKm: number;
  weekDoneKm: number;
  days: DayPlan[];
  upcomingWeeks: UpcomingWeek[];
  race: {
    name: string;
    /** Full race day line ("Søndag 13. september"). */
    dayLabel: string;
    goalTime: string;
    racePace: string;
    aiEstimate: string;
  };
}

export function buildPlanView(now: Date = new Date()): PlanView {
  const home = buildHomeView(now);
  const weekOfPlan = home.plan.weekOfPlan;
  const totalWeeks = home.plan.totalWeeks;
  const daysToRace = home.plan.daysToRace;

  const raceShortDate = `${RACE_DATE.getDate()}. ${DA_MONTHS_SHORT[RACE_DATE.getMonth()]}`;
  const raceDayLabel = `${DA_WEEKDAYS[RACE_DATE.getDay()]} ${RACE_DATE.getDate()}. ${DA_MONTHS_LONG[RACE_DATE.getMonth()]}`;

  const phaseMarkers: PhaseMarker[] = [
    { label: "Base ✓", position: 0, state: "done" },
    { label: "Build · nu", position: 14 / 38, state: "active" },
    { label: "Peak", position: 26 / 38, state: "upcoming" },
    { label: "Taper", position: 34 / 38, state: "upcoming" },
    { label: `Race ${raceShortDate}`, position: 1, state: "race" },
  ];

  const phaseSegments: PhaseSegment[] = [
    { id: "base", flex: 14, fill: "done" },
    { id: "build", flex: 12, fill: "active" },
    { id: "peak", flex: 8, fill: "upcoming" },
    { id: "taper", flex: 4, fill: "upcoming" },
  ];

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
    phaseMarkers,
    phaseSegments,
    raceShortDate,
    weekPlannedKm: 48,
    weekDoneKm: 23.2,
    days,
    upcomingWeeks,
    race: {
      name: "CPH Marathon",
      dayLabel: raceDayLabel,
      goalTime: "3:45",
      racePace: "5:20",
      aiEstimate: "3:41",
    },
  };
}
