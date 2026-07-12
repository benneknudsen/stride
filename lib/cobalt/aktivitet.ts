// Cobalt Glass — Aktivitetsdetalje (single activity) view-model (issue #92).
// Pure derivation (no React) from one activity, mirroring lib/cobalt/hjem.ts and
// lib/cobalt/aktiviteter.ts, so the same presentational cards render demo
// fixtures and live rows.
//
// Every metric a real row can be missing (HR, cadence, speed, calories, zone
// buckets, GPS) is nullable here: the detail page renders whatever the activity
// actually carries and simply omits the rest — it never invents a number and
// never crashes on a hole.

import { type ActivitySource, sourceOf, type ZoneInfo, zoneForHeartRate } from "@/lib/cobalt/hjem";
import { decodePolyline } from "@/lib/cobalt/polyline";
import { ZONE_RAMP, type ZoneKey } from "@/lib/cobalt/zones";
import { demoActivities } from "@/lib/demo/data";
import { formatPace } from "@/lib/metrics";
import { zoneForHeartRate as hrZoneNumber, type ZoneNumber } from "@/lib/training/zones";
import type { HrZone } from "@/types/domain";

const DA_MONTHS_FULL = [
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
const DA_WEEKDAYS_LONG = ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"];

/** Danish label per Strava activity type; unknown types keep their raw name. */
const TYPE_LABELS: Record<string, string> = {
  Run: "Løb",
  TrailRun: "Trailløb",
  TrackRun: "Baneløb",
  VirtualRun: "Virtuelt løb",
  Walk: "Gang",
  Hike: "Vandring",
  Ride: "Cykling",
};

/**
 * The activity fields the detail view reads. The demo fixtures and a full
 * `activities` row both fit: everything the DB stores as nullable is optional
 * here, and the fixtures simply don't carry `hrZones`/`summaryPolyline`.
 */
export interface ActivityDetailLike {
  id: string;
  name: string;
  /** Ingesting provider ("strava" | "garmin"); absent on the demo fixtures (#35). */
  source?: string | null;
  /** Strava activity type — "Run", "TrailRun", … */
  type: string;
  startDate: Date;
  /** Distance in meters. */
  distance: number;
  /** Moving time in seconds. */
  movingTime: number;
  /** Elapsed time in seconds (moving time + stoppage). */
  elapsedTime?: number | null;
  /** Average speed in meters/second. */
  averageSpeed?: number | null;
  /** Max speed in meters/second. */
  maxSpeed?: number | null;
  averageHeartrate?: number | null;
  maxHeartrate?: number | null;
  /** Average cadence (single-leg, Strava convention). */
  averageCadence?: number | null;
  /** Total elevation gain in meters. */
  totalElevationGain?: number | null;
  calories?: number | null;
  /** Strava's per-activity time-in-zone buckets, when the sync captured them. */
  hrZones?: HrZone[] | null;
  /** Google-encoded route polyline, when the run carried GPS. */
  summaryPolyline?: string | null;
}

/** One cell in the "Detaljer" grid. Only present metrics become stats. */
export interface ActivityStatView {
  key: string;
  label: string;
  value: string;
  unit: string;
  tone: "cobalt" | "red";
}

/** One bar of the per-activity zone split. */
export interface ZoneSliceView {
  key: ZoneKey;
  label: string;
  color: string;
  /** Share of moving time, 0–100. */
  percent: number;
  minutes: number;
}

export interface ActivityZoneSplitView {
  slices: ZoneSliceView[];
  /**
   * True when the split was derived from the run's *average* heart rate rather
   * than Strava's per-second zone buckets — the card says so out loud, so an
   * estimate never reads as measured data.
   */
  estimated: boolean;
}

export interface ActivityDetailView {
  id: string;
  name: string;
  typeLabel: string;
  /** "Tirsdag 30. juni · 07:30". */
  dateLabel: string;
  km: number;
  /** "44 min" under an hour, else "1:51 t". */
  durationLabel: string;
  paceLabel: string;
  /** Null when the run has no heart-rate data at all. */
  zone: ZoneInfo | null;
  source: ActivitySource;
  stats: ActivityStatView[];
  zoneSplit: ActivityZoneSplitView;
  /** Empty when the activity carries no GPS route — the card then reads as a placeholder. */
  routeCoords: [number, number][];
  routeElevation: number | null;
}

/** Look an activity up by id; defaults to the demo fixtures (the visitor path). */
export function findActivityById(
  id: string,
  activities: ActivityDetailLike[] = demoActivities
): ActivityDetailLike | null {
  return activities.find((a) => a.id === id) ?? null;
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** "44 min" under an hour, else "1:51 t" — same wording as the activity list. */
export function durationLabel(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}:${String(mins).padStart(2, "0")} t`;
}

/** How the estimated split spreads moving time around the average-HR zone. */
const SPREAD_WEIGHTS = [0.6, 0.17, 0.03];

/**
 * Time-in-zone for a single activity.
 *
 * Strava's `hr_zones` buckets are used whenever the sync captured them. Without
 * them, a run only knows its *average* HR — bucketing all of its moving time
 * into that one zone would draw a 100 % bar that lies about how the effort was
 * spent, so the fallback spreads the time around the average zone with a fixed
 * (deterministic) kernel and the card flags itself as an estimate.
 */
function buildZoneSplit(activity: ActivityDetailLike): ActivityZoneSplitView {
  const seconds: Record<ZoneNumber, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const buckets = activity.hrZones?.filter((b) => b.zone >= 1 && b.zone <= 5) ?? [];
  const measured = buckets.length > 0 && buckets.some((b) => b.seconds > 0);

  if (measured) {
    for (const bucket of buckets) {
      seconds[bucket.zone as ZoneNumber] += bucket.seconds;
    }
  } else if (
    activity.averageHeartrate &&
    activity.averageHeartrate > 0 &&
    activity.movingTime > 0
  ) {
    const center = hrZoneNumber(activity.averageHeartrate);
    const weights = [1, 2, 3, 4, 5].map(
      (zone) => SPREAD_WEIGHTS[Math.abs(zone - center)] ?? 0
    ) as number[];
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    for (const zone of [1, 2, 3, 4, 5] as ZoneNumber[]) {
      seconds[zone] = (activity.movingTime * weights[zone - 1]) / totalWeight;
    }
  } else {
    // No heart-rate data at all — no split to show.
    return { slices: [], estimated: false };
  }

  const total = ([1, 2, 3, 4, 5] as ZoneNumber[]).reduce((sum, z) => sum + seconds[z], 0);
  if (total <= 0) return { slices: [], estimated: false };

  const slices = ZONE_RAMP.map((step, i) => {
    const zoneSeconds = seconds[(i + 1) as ZoneNumber];
    return {
      key: step.key,
      label: step.label,
      color: step.color,
      percent: (zoneSeconds / total) * 100,
      minutes: Math.round(zoneSeconds / 60),
    };
  });

  return { slices, estimated: !measured };
}

function buildStats(activity: ActivityDetailLike, zone: ZoneInfo | null): ActivityStatView[] {
  const stats: ActivityStatView[] = [];

  stats.push({
    key: "pace",
    label: "Tempo",
    value: formatPace(activity.averageSpeed ?? null),
    unit: "min/km",
    // Pace reads red on hard efforts, cobalt otherwise — as in the activity list.
    tone: zone?.tone === "red" ? "red" : "cobalt",
  });

  if (activity.maxSpeed && activity.maxSpeed > 0) {
    stats.push({
      key: "maxPace",
      label: "Hurtigste tempo",
      value: formatPace(activity.maxSpeed),
      unit: "min/km",
      tone: "cobalt",
    });
  }

  if (activity.averageHeartrate && activity.averageHeartrate > 0) {
    stats.push({
      key: "hr",
      label: "Gennemsnitspuls",
      value: String(Math.round(activity.averageHeartrate)),
      unit: "bpm",
      tone: "cobalt",
    });
  }

  if (activity.maxHeartrate && activity.maxHeartrate > 0) {
    stats.push({
      key: "maxHr",
      label: "Makspuls",
      value: String(Math.round(activity.maxHeartrate)),
      unit: "bpm",
      tone: "red",
    });
  }

  stats.push({
    key: "elevation",
    label: "Højdemeter",
    value: String(Math.round(activity.totalElevationGain ?? 0)),
    unit: "m",
    tone: "cobalt",
  });

  if (activity.averageCadence && activity.averageCadence > 0) {
    stats.push({
      key: "cadence",
      label: "Kadence",
      // Strava stores single-leg cadence; runners read steps per minute.
      value: String(Math.round(activity.averageCadence * 2)),
      unit: "skridt/min",
      tone: "cobalt",
    });
  }

  if (activity.calories && activity.calories > 0) {
    stats.push({
      key: "calories",
      label: "Forbrænding",
      value: String(Math.round(activity.calories)),
      unit: "kcal",
      tone: "cobalt",
    });
  }

  const elapsed = activity.elapsedTime ?? null;
  if (elapsed && elapsed > 0) {
    stats.push({
      key: "elapsed",
      label: "Samlet tid",
      value: durationLabel(elapsed),
      unit: "inkl. pauser",
      tone: "cobalt",
    });
  }

  return stats;
}

export function buildActivityDetailView(activity: ActivityDetailLike): ActivityDetailView {
  const hr = activity.averageHeartrate ?? 0;
  const zone = hr > 0 ? zoneForHeartRate(hr) : null;
  const date = activity.startDate;

  return {
    id: activity.id,
    name: activity.name,
    typeLabel: TYPE_LABELS[activity.type] ?? activity.type,
    dateLabel: `${DA_WEEKDAYS_LONG[date.getDay()]} ${date.getDate()}. ${DA_MONTHS_FULL[date.getMonth()]} · ${clock(date)}`,
    km: activity.distance / 1000,
    durationLabel: durationLabel(activity.movingTime),
    paceLabel: formatPace(activity.averageSpeed ?? null),
    zone,
    source: sourceOf(activity),
    stats: buildStats(activity, zone),
    zoneSplit: buildZoneSplit(activity),
    routeCoords: decodePolyline(activity.summaryPolyline),
    routeElevation:
      activity.totalElevationGain != null ? Math.round(activity.totalElevationGain) : null,
  };
}
