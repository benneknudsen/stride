// Cobalt Glass — Aktiviteter (Activities) view-model.
// Pure derivation (no React) from activity data, mirroring lib/cobalt/hjem.ts,
// so the same presentational rows render demo and live data. Bucketing is
// day/month-granular, keeping server render and client hydration in agreement.
//
// buildActivitiesView() defaults to the demo fixtures (the unauthenticated
// fallback); the server page passes getDashboardActivities rows for signed-in
// users (issue #84).

import {
  ACTIVITY_SOURCE,
  type ActivitySource,
  type HomeActivityLike,
  type ZoneInfo,
  zoneForHeartRate,
} from "@/lib/cobalt/hjem";
import { demoActivities } from "@/lib/demo/data";
import { formatPace } from "@/lib/metrics";

const DA_MONTHS_FULL = [
  "Januar",
  "Februar",
  "Marts",
  "April",
  "Maj",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "December",
];
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
const DA_WEEKDAYS = ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"];

/** Filter buckets — plain-language, never zone codes. */
export type ActivityFilter = "alle" | "rolig" | "moderat" | "haard";
export type ActivityCategory = Exclude<ActivityFilter, "alle">;

/** Map an IntensityMeter level (1–5) to its filter bucket. */
export function activityCategory(level: number): ActivityCategory {
  if (level <= 2) return "rolig";
  if (level === 3) return "moderat";
  return "haard";
}

/** Format total seconds as `h:mm` for the "timer" total (e.g. 7:11). */
export function formatTimerLabel(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}:${String(mins).padStart(2, "0")}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** "44 min" under an hour, else "1:51 t". */
function durationLabel(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}:${String(mins).padStart(2, "0")} t`;
}

/** "I dag 07:30 · 44 min" for today, else "Tir 30. jun · 45 min". */
function metaLabel(date: Date, now: Date, movingTime: number): string {
  const dayPart =
    startOfDay(date) === startOfDay(now)
      ? `I dag ${clock(date)}`
      : `${DA_WEEKDAYS[date.getDay()]} ${date.getDate()}. ${DA_MONTHS_SHORT[date.getMonth()]}`;
  return `${dayPart} · ${durationLabel(movingTime)}`;
}

export interface ActivityRowView {
  id: string;
  name: string;
  metaLabel: string;
  zone: ZoneInfo;
  category: ActivityCategory;
  source: ActivitySource;
  km: number;
  paceLabel: string;
  /** Pace reads red on hard efforts, cobalt otherwise. */
  paceTone: "cobalt" | "red";
  hr: number;
}

export interface ActivitiesView {
  /** Month range of the shown activities, e.g. "Juni – Juli". */
  periodLabel: string;
  totalKm: number;
  totalRuns: number;
  totalSeconds: number;
  rows: ActivityRowView[];
}

/** Running activity types: "Run", "TrailRun", "VirtualRun", … */
function isRun(activity: HomeActivityLike): boolean {
  return /run/i.test(activity.type);
}

export function buildActivitiesView(
  activities: HomeActivityLike[] = demoActivities,
  now: Date = new Date()
): ActivitiesView {
  // Runs only — the totals ("N løb", km, timer) and the intensity filters read
  // as running stats. Same predicate as lib/coach/dashboard.ts.
  const runs = activities.filter(isRun);

  // "Month totals" window: from the start of the previous calendar month up to
  // now — a natural recent span that reads as e.g. "Juni – Juli".
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const inWindow = runs.filter((a) => a.startDate.getTime() >= windowStart);

  const rows: ActivityRowView[] = inWindow.map((a) => {
    const zone = zoneForHeartRate(a.averageHeartrate ?? 0);
    return {
      id: a.id,
      name: a.name,
      metaLabel: metaLabel(a.startDate, now, a.movingTime),
      zone,
      category: activityCategory(zone.level),
      source: ACTIVITY_SOURCE,
      km: a.distance / 1000,
      paceLabel: formatPace(a.averageSpeed),
      paceTone: zone.tone,
      hr: Math.round(a.averageHeartrate ?? 0),
    };
  });

  // Order months chronologically, not by month number: across a year boundary
  // the window holds December (11) and January (0), and comparing the raw month
  // index would render "Januar – December" instead of "December – Januar".
  // Live data can also leave the window empty (all rows older than last month) —
  // fall back to the current month so the header never reads "undefined".
  const ordinals = inWindow.map((a) => a.startDate.getFullYear() * 12 + a.startDate.getMonth());
  const nowOrdinal = now.getFullYear() * 12 + now.getMonth();
  const minOrdinal = ordinals.length > 0 ? Math.min(...ordinals) : nowOrdinal;
  const maxOrdinal = ordinals.length > 0 ? Math.max(...ordinals) : nowOrdinal;
  const monthName = (ordinal: number) => DA_MONTHS_FULL[ordinal % 12];
  const periodLabel =
    minOrdinal === maxOrdinal
      ? monthName(minOrdinal)
      : `${monthName(minOrdinal)} – ${monthName(maxOrdinal)}`;

  return {
    periodLabel,
    totalKm: inWindow.reduce((sum, a) => sum + a.distance / 1000, 0),
    totalRuns: inWindow.length,
    totalSeconds: inWindow.reduce((sum, a) => sum + a.movingTime, 0),
    rows,
  };
}
