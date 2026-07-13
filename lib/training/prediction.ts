// Stride — race predictor (issue #115). Turns a runner's recent efforts into a
// predicted race time, and that prediction into the training paces the plan
// prescribes. The plan page used to hardcode every pace target; these two
// functions are what let it derive them instead.
//
// Prediction uses Riegel's endurance model — T₂ = T₁ × (D₂/D₁)^1.06 — the same
// extrapolation every race calculator runs on. The anchoring effort is the
// runner's *best* recent projection rather than their average: an easy jog says
// nothing about race potential, while a hard 10 km says a great deal. Runs
// shorter than {@link MIN_BASIS_KM} are ignored — Riegel over-projects wildly
// from a sprint.
//
// Everything here is pure and deterministic (`now` is injected, never read):
// the same activities always yield the same paces, so a server render and a
// client hydration can't disagree.

import { formatPace } from "@/lib/metrics";

const DAY_MS = 86_400_000;

/** The race the plan builds toward — the distance `getWeekPlan` already prescribes on race day. */
export const HALF_MARATHON_KM = 21.0975;

/** Riegel's fatigue exponent. 1.06 is the canonical value for trained runners. */
const RIEGEL_EXPONENT = 1.06;

/** Shortest effort that may anchor a prediction — below this Riegel over-projects. */
const MIN_BASIS_KM = 5;

/** How far back an effort still says something about current fitness. */
const LOOKBACK_DAYS = 84;

/** Training targets are rounded to this grid — a coach says "5:30", not "5:28". */
const PACE_GRID_SECONDS = 5;

/** Half-width of a pace target range, in seconds ("MÅL 5:20–5:40"). */
const PACE_RANGE_SPREAD_SECONDS = 10;

/** The pace vocabulary the plan prescribes in. */
export type PaceZone = "recovery" | "easy" | "tempo" | "interval" | "long";

/**
 * Each training pace as a fraction of race **speed** (issue #115) — so a
 * fraction below 1 is slower than race pace and above 1 is faster. Working in
 * speed rather than in the pace number is what keeps the ordering intuitive:
 * intervals (1.05) are the only zone run faster than the race itself.
 */
export const PACE_ZONE_SPEED_FRACTION: Record<PaceZone, number> = {
  recovery: 0.65,
  easy: 0.75,
  tempo: 0.88,
  interval: 1.05,
  long: 0.8,
};

/** The activity fields the predictor reads — live rows and demo fixtures both fit. */
export interface PredictionActivity {
  /** Strava activity type, e.g. "Run", "TrailRun", "Ride". */
  type: string;
  /** Distance in meters. */
  distance: number;
  /** Moving time in seconds. */
  movingTime: number;
  startDate: Date;
}

/**
 * How much the prediction is worth. "low" means it rests on a single qualifying
 * effort or one far shorter than the race; "high" means a body of recent work
 * with at least one effort in the race's own distance neighbourhood.
 */
export type PredictionConfidence = "low" | "medium" | "high";

export interface RacePrediction {
  raceDistanceKm: number;
  /** Predicted finish time, in seconds. */
  timeSeconds: number;
  /** Predicted race pace, in seconds per km. */
  paceSecPerKm: number;
  /** Distance of the effort the extrapolation is anchored on, in km. */
  basisKm: number;
  /** How many recent runs qualified as candidates. */
  sampleRuns: number;
  confidence: PredictionConfidence;
}

/** Running activity types: "Run", "TrailRun", "VirtualRun", … */
function isRun(activity: PredictionActivity): boolean {
  return /run/i.test(activity.type);
}

/** A basis at least this share of the race distance makes Riegel a short hop, not a leap. */
const CONFIDENT_BASIS_SHARE = 0.4;

function confidenceFor(
  sampleRuns: number,
  basisKm: number,
  raceDistanceKm: number
): PredictionConfidence {
  const closeBasis = basisKm >= raceDistanceKm * CONFIDENT_BASIS_SHARE;
  if (sampleRuns >= 6 && closeBasis) return "high";
  if (sampleRuns >= 3) return "medium";
  return "low";
}

/**
 * Predict the runner's race time from their recent training, or null when
 * nothing in the last {@link LOOKBACK_DAYS} days qualifies as an anchor — the
 * engine's "never guess" rule, which is what makes the plan fall back to its
 * template instead of inventing paces from thin air.
 */
export function predictRace(
  activities: PredictionActivity[],
  now: Date,
  raceDistanceKm: number = HALF_MARATHON_KM
): RacePrediction | null {
  const nowMs = now.getTime();
  const candidates = activities.filter((activity) => {
    const time = activity.startDate.getTime();
    return (
      isRun(activity) &&
      time <= nowMs &&
      time >= nowMs - LOOKBACK_DAYS * DAY_MS &&
      activity.distance >= MIN_BASIS_KM * 1000 &&
      activity.movingTime > 0
    );
  });
  if (candidates.length === 0) return null;

  // The best projection any recent effort supports — the runner's ceiling, not
  // the average of their easy days.
  let bestSeconds = Number.POSITIVE_INFINITY;
  let basisKm = 0;
  for (const run of candidates) {
    const ratio = (raceDistanceKm * 1000) / run.distance;
    const seconds = run.movingTime * ratio ** RIEGEL_EXPONENT;
    if (seconds < bestSeconds) {
      bestSeconds = seconds;
      basisKm = run.distance / 1000;
    }
  }

  return {
    raceDistanceKm,
    timeSeconds: Math.round(bestSeconds),
    paceSecPerKm: Math.round(bestSeconds / raceDistanceKm),
    basisKm: Math.round(basisKm * 10) / 10,
    sampleRuns: candidates.length,
    confidence: confidenceFor(candidates.length, basisKm, raceDistanceKm),
  };
}

/**
 * The target pace for a training zone, in seconds per km, rounded to the
 * {@link PACE_GRID_SECONDS} grid a coach would actually say out loud.
 */
export function zonePaceSeconds(prediction: RacePrediction, zone: PaceZone): number {
  const seconds = prediction.paceSecPerKm / PACE_ZONE_SPEED_FRACTION[zone];
  return Math.round(seconds / PACE_GRID_SECONDS) * PACE_GRID_SECONDS;
}

/** Every zone's target pace (seconds per km) for one prediction. */
export function zonePaces(prediction: RacePrediction): Record<PaceZone, number> {
  return {
    recovery: zonePaceSeconds(prediction, "recovery"),
    easy: zonePaceSeconds(prediction, "easy"),
    tempo: zonePaceSeconds(prediction, "tempo"),
    interval: zonePaceSeconds(prediction, "interval"),
    long: zonePaceSeconds(prediction, "long"),
  };
}

/** A pace in seconds/km as `m:ss` ("5:30"). */
export function formatPaceClock(secondsPerKm: number): string {
  return formatPace(1000 / secondsPerKm);
}

/** A target pace as a range around the zone's centre ("5:20–5:40"). */
export function formatPaceRange(
  secondsPerKm: number,
  spread: number = PACE_RANGE_SPREAD_SECONDS
): string {
  return `${formatPaceClock(secondsPerKm - spread)}–${formatPaceClock(secondsPerKm + spread)}`;
}

/** A race time in seconds as `h:mm` ("1:38") — the race card's format. */
export function formatRaceTime(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

/**
 * A committable goal time: the prediction rounded UP to the next `stepMinutes`
 * boundary. The estimate is what the model expects; the goal is the round
 * number just above it that a runner actually writes on their hand.
 */
export function goalTimeFor(seconds: number, stepMinutes = 5): string {
  const step = stepMinutes * 60;
  return formatRaceTime(Math.ceil(seconds / step) * step);
}
