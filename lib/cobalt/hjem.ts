// Cobalt Glass — Hjem (Dashboard) view-model.
// Pure derivation (no React) from activity data, so the exact same
// presentational widgets render demo and live data. Every value is day-granular
// or activity-derived, keeping server render and client hydration in agreement.
//
// buildHomeView() defaults to the demo fixtures (the unauthenticated fallback);
// the server page passes getDashboardActivities rows for signed-in users
// (issue #84), mirroring lib/cobalt/coach.ts. The race is a parameter too
// (issue #99): the server page passes the user's own race date/name, and the
// defaults keep visitors on the engine's demo race.

import { DEFAULT_RACE_DATE, DEFAULT_RACE_NAME, planTotalWeeks } from "@/lib/coach/engine";
import { demoActivities } from "@/lib/demo/data";
import { formatDuration, formatPace, getWeeklyVolume } from "@/lib/metrics";

const DAY_MS = 86_400_000;

const DA_MONTHS = [
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

const DA_WEEKDAYS_LONG = ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"];

/**
 * Where an activity was ingested from. Strava is the only provider the app
 * syncs (issue #96 — the views used to alternate a fabricated "garmin"/"strava"
 * badge per row); the union keeps room for a second provider without touching
 * every call site.
 */
export type ActivitySource = "garmin" | "strava";

export interface ZoneInfo {
  /** IntensityMeter level 1–5. */
  level: number;
  /** Plain-language Danish zone (never "Z3"). */
  label: string;
  tone: "cobalt" | "red";
}

/** Map an average heart rate to a plain-language training zone. */
export function zoneForHeartRate(hr: number): ZoneInfo {
  if (hr < 135) return { level: 2, label: "Rolig snak-fart", tone: "cobalt" };
  if (hr < 150) return { level: 3, label: "Moderat tempo", tone: "cobalt" };
  if (hr < 165) return { level: 4, label: "Hårdt tempo", tone: "red" };
  return { level: 5, label: "Meget hårdt", tone: "red" };
}

/** Danish time-of-day greeting for the serif hero line. */
export function greetingForHour(hour: number): string {
  if (hour < 10) return "Godmorgen";
  if (hour < 18) return "Goddag";
  return "Godaften";
}

/** ISO-8601 week number. */
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "I DAG" / "1 DAG" / "N DAGE" relative to now. */
function relativeDayLabel(date: Date, now: Date): string {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return "I DAG";
  if (days === 1) return "1 DAG";
  return `${days} DAGE`;
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function danishDate(date: Date): string {
  return `${date.getDate()}. ${DA_MONTHS[date.getMonth()]}`;
}

/** Average pace (seconds/km) across activities within the last `days`, or null. */
function windowPaceSeconds(
  activities: HomeActivityLike[],
  now: Date,
  fromDaysAgo: number,
  toDaysAgo: number
): number | null {
  const from = now.getTime() - fromDaysAgo * DAY_MS;
  const to = now.getTime() - toDaysAgo * DAY_MS;
  let dist = 0;
  let time = 0;
  for (const a of activities) {
    const t = a.startDate.getTime();
    if (t >= from && t < to) {
      dist += a.distance;
      time += a.movingTime;
    }
  }
  if (dist === 0) return null;
  return time / (dist / 1000);
}

function paceSecondsToClock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs === 60 ? 0 : secs).padStart(2, "0")}`;
}

/** Signed pace delta like "−0:09" (padded m:ss). */
function paceDelta(seconds: number): string {
  const sign = seconds < 0 ? "−" : "+";
  const abs = Math.abs(Math.round(seconds));
  const mins = Math.floor(abs / 60);
  const secs = abs % 60;
  return `${sign}${mins}:${String(secs).padStart(2, "0")}`;
}

export interface LatestActivityView {
  name: string;
  km: number;
  paceLabel: string;
  hr: number;
  spm: number;
  elevation: number;
  durationLabel: string;
  zone: ZoneInfo;
  source: ActivitySource;
  dayLabel: string;
  clock: string;
  /** Deterministic pace-curve samples (relative 0–1, higher = faster). */
  paceCurve: number[];
}

/**
 * The activity fields the view-model reads — demo fixtures and
 * getDashboardActivities rows both fit. The averages are nullable because the
 * DB columns are (a run without HR/cadence data); fixtures always carry them.
 */
export interface HomeActivityLike {
  id: string;
  name: string;
  /** Strava activity type — "Run", "TrailRun", "Ride", … */
  type: string;
  startDate: Date;
  /** Distance in meters. */
  distance: number;
  /** Moving time in seconds. */
  movingTime: number;
  /** Average speed in meters/second. */
  averageSpeed: number | null;
  averageHeartrate: number | null;
  /** Average cadence (single-leg, Strava convention). */
  averageCadence: number | null;
  totalElevationGain: number;
}

export interface RecentRunView {
  id: string;
  name: string;
  dateLabel: string;
  zone: ZoneInfo;
  source: ActivitySource;
  km: number;
  paceLabel: string;
}

export interface HomeView {
  weekNumber: number;
  weeklyKm: number;
  latest: LatestActivityView;
  routeCoords: [number, number][];
  routeKm: number;
  routeElevation: number;
  avgPaceLabel: string;
  avgPaceFraction: number;
  avgPaceDeltaLabel: string;
  volumeBars: { id: string; km: number }[];
  recoveryPct: number;
  recoveryNote: string;
  /** The hero's second line — same recovery band as `recoveryNote`, as a sentence. */
  heroNote: string;
  coachQuote: string;
  recentRuns: RecentRunView[];
  plan: {
    weekOfPlan: number;
    totalWeeks: number;
    progressPct: number;
    daysToRace: number;
    goalLabel: string;
    raceDateLabel: string;
    /** Display name of the target race ("Silkeborg Halvmarathon"). */
    raceName: string;
    /** Strip/header title ("Træningsplan · Silkeborg Halvmarathon"). */
    planTitle: string;
    /** True once the race day is behind `now` — drives the "vælg din næste race" CTA. */
    racePassed: boolean;
  };
}

// A ~5 km loop around the Copenhagen lakes ("Søerne"), used as the route
// polyline. In production this is the activity's real GPS stream.
const ROUTE_COORDS: [number, number][] = [
  [55.6839, 12.5636],
  [55.685, 12.5658],
  [55.6867, 12.5681],
  [55.6885, 12.5702],
  [55.6903, 12.5715],
  [55.6921, 12.5719],
  [55.6934, 12.5705],
  [55.6939, 12.5678],
  [55.6932, 12.5651],
  [55.6918, 12.5629],
  [55.69, 12.5613],
  [55.6882, 12.5601],
  [55.6864, 12.5592],
  [55.6848, 12.5586],
  [55.6835, 12.5598],
  [55.683, 12.5618],
];

// Deterministic pace-curve shape (relative, higher = faster). Fixture data has
// no per-activity streams, so this is a plausible negative-split effort.
const PACE_CURVE = [
  0.28, 0.34, 0.4, 0.38, 0.45, 0.52, 0.5, 0.58, 0.63, 0.6, 0.68, 0.72, 0.7, 0.78, 0.85, 0.82, 0.9,
  0.95, 0.88, 0.98,
];

/** Running activity types: "Run", "TrailRun", "VirtualRun", … */
function isRun(activity: HomeActivityLike): boolean {
  return /run/i.test(activity.type);
}

/**
 * Every activity the app holds came in over the Strava sync — the fixtures stand
 * in for exactly that. Change this the day a second provider is ingested.
 */
export const ACTIVITY_SOURCE: ActivitySource = "strava";

export function buildHomeView(
  activities: HomeActivityLike[] = demoActivities,
  now: Date = new Date(),
  raceDate: Date = DEFAULT_RACE_DATE,
  raceName: string = DEFAULT_RACE_NAME
): HomeView {
  // Pace, volume and zones are only meaningful over runs — a ride or a swim
  // would skew every one of them. Same predicate as lib/coach/dashboard.ts and
  // lib/training/progression.ts.
  const filtered = activities.filter(isRun);
  // Every field below reads runs[0]. A signed-in user whose synced activities
  // are all cross-training passes the caller's `activities.length > 0` guard but
  // filters down to nothing, so fall back to the fixtures here — the same
  // demo-data path the pages take for users with no synced runs.
  const runs = filtered.length > 0 ? filtered : demoActivities;

  const latest = runs[0];
  const latestHr = latest.averageHeartrate ?? 0;
  const latestZone = zoneForHeartRate(latestHr);

  const weeklyKm = getWeeklyVolume(runs, 0) / 1000;

  const last7 = windowPaceSeconds(runs, now, 7, 0);
  const prev7 = windowPaceSeconds(runs, now, 14, 7);
  // Fallback pace from the totals (distance/movingTime are never null).
  const latestPaceSeconds =
    latest.distance > 0 ? latest.movingTime / (latest.distance / 1000) : 390;
  const avgPaceSeconds = last7 ?? latestPaceSeconds;
  const deltaSeconds = last7 !== null && prev7 !== null ? last7 - prev7 : -9;
  // Ring fill: map pace 4:00–6:30 /km onto 0–1 (faster = fuller).
  const avgPaceFraction = Math.min(1, Math.max(0, (390 - avgPaceSeconds) / (390 - 240)));

  // Last 10 activities, oldest→newest, as volume bars (final bar = most recent).
  const volumeBars = runs
    .slice(0, 10)
    .map((a) => ({ id: a.id, km: a.distance / 1000 }))
    .reverse();

  const recoveryPct = Math.min(95, Math.max(60, Math.round(150 - latestHr * 0.45)));
  // One recovery band feeds three surfaces — the RecoveryCard note, the hero's
  // second line and the coach quote — so the hero can never claim the body is
  // ready while the card next to it prescribes rest.
  const recoveryBand = recoveryPct >= 80 ? "ready" : recoveryPct >= 68 ? "easy" : "rest";
  const recoveryNote = {
    ready: "Klar til hårdt pas",
    easy: "Let træning anbefalet",
    rest: "Prioritér hvile i dag",
  }[recoveryBand];
  const heroNote = {
    ready: "Kroppen er klar i dag.",
    easy: "Hold tempoet roligt i dag.",
    rest: "Kroppen har brug for hvile.",
  }[recoveryBand];

  // The latest run owns its own card, so the list starts at the second run —
  // unless that's the only run there is, in which case show it here rather than
  // render an empty "Seneste ture" card.
  const recentSource = runs.length > 1 ? runs.slice(1, 6) : runs.slice(0, 1);

  const recentRuns: RecentRunView[] = recentSource.map((a) => ({
    id: a.id,
    name: a.name,
    dateLabel: danishDate(a.startDate),
    zone: zoneForHeartRate(a.averageHeartrate ?? 0),
    source: ACTIVITY_SOURCE,
    km: a.distance / 1000,
    paceLabel: formatPace(a.averageSpeed),
  }));

  // Day-granular countdown (local midnights, never raw timestamp diffs) so a
  // boundary evening can't flip the count, and race day itself reads 0.
  const daysToRace = Math.max(0, Math.round((startOfDay(raceDate) - startOfDay(now)) / DAY_MS));
  const racePassed = startOfDay(now) > startOfDay(raceDate);
  const totalWeeks = planTotalWeeks(raceDate);
  // Race week (0–6 days out) is the plan's final week; each further 7 days is
  // one week earlier. Pre-plan dates clamp to week 1.
  const weekOfPlan = Math.min(totalWeeks, Math.max(1, totalWeeks - Math.floor(daysToRace / 7)));

  const coachQuote =
    recoveryBand === "ready"
      ? "Restitutionen ser stærk ud. Kør ugens tempopas som planlagt — kroppen er klar."
      : "Hold intensiteten nede i dag. En rolig snak-fart bygger form uden at koste restitution.";

  return {
    weekNumber: isoWeek(now),
    weeklyKm,
    latest: {
      name: latest.name,
      km: latest.distance / 1000,
      paceLabel: formatPace(latest.averageSpeed),
      hr: Math.round(latestHr),
      spm: Math.round((latest.averageCadence ?? 0) * 2),
      elevation: latest.totalElevationGain,
      durationLabel: formatDuration(latest.movingTime),
      zone: latestZone,
      source: ACTIVITY_SOURCE,
      dayLabel: relativeDayLabel(latest.startDate, now),
      clock: clock(latest.startDate),
      paceCurve: PACE_CURVE,
    },
    routeCoords: ROUTE_COORDS,
    routeKm: latest.distance / 1000,
    routeElevation: latest.totalElevationGain,
    avgPaceLabel: paceSecondsToClock(avgPaceSeconds),
    avgPaceFraction,
    avgPaceDeltaLabel: paceDelta(deltaSeconds),
    volumeBars,
    recoveryPct,
    recoveryNote,
    heroNote,
    coachQuote,
    recentRuns,
    plan: {
      weekOfPlan,
      totalWeeks,
      progressPct: Math.round((weekOfPlan / totalWeeks) * 100),
      daysToRace,
      goalLabel: "Mål under 3:45",
      raceDateLabel: `${DA_WEEKDAYS_LONG[raceDate.getDay()]} ${danishDate(raceDate)}`,
      raceName,
      planTitle: `Træningsplan · ${raceName}`,
      racePassed,
    },
  };
}
