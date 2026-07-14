// Stride — race predictor (issue #115). Turns a runner's recent efforts into a
// predicted race time, and that prediction into the training paces the plan
// prescribes. The plan page used to hardcode every pace target; these two
// functions are what let it derive them instead.
//
// Prediction uses Riegel's endurance model — T₂ = T₁ × (D₂/D₁)^1.06 — the same
// extrapolation every race calculator runs on. The anchoring effort is the
// runner's *best* recent projection rather than their average: an easy jog says
// nothing about race potential, while a hard 10 km says a great deal. Runs
// shorter than {@link minBasisKm} are ignored — Riegel over-projects wildly from
// a sprint, and the further it has to reach, the wilder it gets.
//
// Riegel alone assumes the anchoring effort was run *at race effort*. It wasn't,
// usually — so the anchor is discounted by how far below race effort its heart
// rate says it was run (issue #116). The discount only ever slows a prediction
// down: Riegel's own projection is the ceiling, never a floor we'd bid past.
//
// A prediction we can't make is not a null we quietly swallow (issue #117):
// {@link predictRace} always returns a result carrying *why* it couldn't
// predict, so the race card can tell the runner what would unlock it.
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

/** Floor on the anchoring distance — below this Riegel over-projects from any race. */
const MIN_BASIS_KM = 5;

/**
 * …but the floor alone would let a single 5 km unlock a marathon estimate, which
 * Riegel is in no position to make. So the real bar is a share of the race the
 * runner is actually training for.
 */
const MIN_BASIS_FRACTION = 0.25;

/** The bar is stated to the runner, so it's rounded to a distance they'd go out and run. */
const BASIS_GRID_KM = 0.5;

/**
 * The shortest effort that may anchor a prediction for this race: the greater of
 * {@link MIN_BASIS_KM} and {@link MIN_BASIS_FRACTION} of the race distance. The
 * gate and the copy that asks for it are the same number by construction — a
 * runner who runs exactly what we asked for unlocks the estimate.
 */
export function minBasisKm(raceDistanceKm: number): number {
  const required = Math.max(MIN_BASIS_KM, raceDistanceKm * MIN_BASIS_FRACTION);
  return Math.round(required / BASIS_GRID_KM) * BASIS_GRID_KM;
}

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

/**
 * The heart-rate fraction of max a runner holds when they actually race. An
 * effort at or above this is taken at face value; below it, the projection is
 * discounted (see {@link hrAdjustmentFor}).
 */
const RACE_EFFORT_FRACTION = 0.9;

/** How hard a sub-race-effort anchor is discounted, per point of missing effort. */
const HR_EFFORT_STRENGTH = 0.6;

/** Ceiling on that discount — an easy jog is weak evidence, not useless evidence. */
const MAX_HR_ADJUSTMENT = 1.12;

/** Below this, an `hrMaxOverride` is bad data (a resting HR, a stray 0) — ignore it. */
const MIN_PLAUSIBLE_HR_MAX = 120;

/** The activity fields the predictor reads — live rows and demo fixtures both fit. */
export interface PredictionActivity {
  /** Strava activity type, e.g. "Run", "TrailRun", "Ride". */
  type: string;
  /** Distance in meters. */
  distance: number;
  /** Moving time in seconds. */
  movingTime: number;
  startDate: Date;
  /**
   * Average heart rate in bpm (issue #116). Nullable — the DB column is, and a
   * run logged without a strap simply doesn't get its effort discounted.
   */
  averageHeartrate?: number | null;
}

/**
 * How much the prediction is worth. "low" means it rests on a single qualifying
 * effort or one far shorter than the race; "high" means a body of recent work
 * with at least one effort in the race's own distance neighbourhood.
 */
export type PredictionConfidence = "low" | "medium" | "high";

/**
 * Where the heart-rate ceiling came from (issue #116). "database" is the
 * runner's true max across their whole history (`getUserHrMax`) — the only
 * source that can't be dragged down by a soft training block. "observations" is
 * the hardest *average* HR among the runs in hand, a floor on the real max, so
 * the effort discount it produces is conservative. "unknown" means no run
 * carried heart rate and no discount was applied at all.
 */
export type HrMaxSource = "database" | "observations" | "unknown";

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
  /**
   * The heart-rate ceiling the effort discount was measured against (issue
   * #116) — the caller's `hrMaxOverride` when given, otherwise the hardest
   * average HR seen among the candidates. Null when no run carried HR.
   */
  hrMax: number | null;
  /** Where that ceiling came from (issue #116) — see {@link HrMaxSource}. */
  hrMaxSource: HrMaxSource;
  /**
   * The factor the anchor's Riegel projection was multiplied by (issue #116).
   * Exactly 1 when the anchor was run at race effort or carried no HR; above 1
   * — never below — when it was run easier than a race.
   */
  hrAdjustment: number;
}

/** Why the predictor couldn't predict — each one names a thing the runner can do. */
export type PredictionLockReason = "no-runs" | "stale-runs" | "runs-too-short";

/** A distance as Danish decimal copy — "5,5", "10" (a whole number keeps no comma). */
function formatKm(km: number): string {
  return String(km).replace(".", ",");
}

/**
 * Danish, action-directing copy for the locked race card (issue #117). Each
 * message is written against the distance that would unlock *this* race, so a
 * marathon runner is asked for the 10,5 km that could anchor one — not the 5 km
 * that couldn't.
 */
const LOCK_MESSAGES: Record<PredictionLockReason, (km: number) => string> = {
  "no-runs": () =>
    "Synkronisér dine løbeture fra Strava eller Garmin, så beregner vi dit race-estimat.",
  "stale-runs": (km) =>
    `Vi kan ikke se nogen løbeture fra de sidste ${LOOKBACK_DAYS} dage. Løb en tur på mindst ${formatKm(km)} km, så låser vi dit race-estimat op.`,
  "runs-too-short": (km) =>
    `Dine seneste ture er under ${formatKm(km)} km. Løb ${formatKm(km)} km eller mere, så låser vi dit race-estimat op.`,
};

/**
 * What {@link predictRace} returns. `prediction` is null exactly when `reason`,
 * `message` and `requiredKm` are set — the "never guess" rule (issue #117): the
 * engine says what it's missing rather than inventing a race time from thin air.
 */
export interface RacePredictionResult {
  prediction: RacePrediction | null;
  reason: PredictionLockReason | null;
  message: string | null;
  /** The run that would unlock the estimate, in km — {@link minBasisKm} for this race. */
  requiredKm: number | null;
}

function locked(reason: PredictionLockReason, requiredKm: number): RacePredictionResult {
  return { prediction: null, reason, message: LOCK_MESSAGES[reason](requiredKm), requiredKm };
}

/** Running activity types: "Run", "TrailRun", "VirtualRun", … */
function isRun(activity: PredictionActivity): boolean {
  return /run/i.test(activity.type);
}

/**
 * The HR ceiling every effort is measured against. `override` is the runner's
 * true observed max (the `max_heartrate` column — see `getUserHrMax`); without
 * it we fall back to the hardest *average* HR among the candidates, which is a
 * floor on the real max, so the discount stays conservative rather than wrong.
 */
function hrCeiling(
  candidates: PredictionActivity[],
  override?: number | null
): { hrMax: number | null; source: HrMaxSource } {
  if (override && override >= MIN_PLAUSIBLE_HR_MAX) {
    return { hrMax: override, source: "database" };
  }
  let max = 0;
  for (const run of candidates) {
    const hr = run.averageHeartrate ?? 0;
    if (hr > max) max = hr;
  }
  return max > 0 ? { hrMax: max, source: "observations" } : { hrMax: null, source: "unknown" };
}

/**
 * How much to slow an effort's Riegel projection down, given how far below race
 * effort its heart rate says it was run. Never returns below 1: a run at (or
 * above) race effort is trusted as-is, and no run is ever extrapolated to be
 * *faster* than what it actually projects.
 */
function hrAdjustmentFor(activity: PredictionActivity, hrMax: number | null): number {
  const hr = activity.averageHeartrate ?? 0;
  if (!hrMax || hr <= 0) return 1;
  const effort = Math.min(1, hr / hrMax);
  if (effort >= RACE_EFFORT_FRACTION) return 1;
  return Math.min(MAX_HR_ADJUSTMENT, 1 + HR_EFFORT_STRENGTH * (RACE_EFFORT_FRACTION - effort));
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
 * Predict the runner's race time from their recent training. When nothing in the
 * last {@link LOOKBACK_DAYS} days qualifies as an anchor the result carries a
 * `reason` and a `message` instead of a prediction (issue #117) — the engine's
 * "never guess" rule, which is what makes the plan fall back to its template
 * instead of inventing paces from thin air, and what lets the race card tell the
 * runner what would unlock it.
 *
 * `hrMaxOverride` (issue #116) is the runner's true max heart rate — the ceiling
 * every effort's HR is measured against. Without it the predictor makes do with
 * the hardest average HR it can see among the candidates.
 */
export function predictRace(
  activities: PredictionActivity[],
  now: Date,
  raceDistanceKm: number = HALF_MARATHON_KM,
  hrMaxOverride?: number | null
): RacePredictionResult {
  const nowMs = now.getTime();
  const requiredKm = minBasisKm(raceDistanceKm);
  const runs = activities.filter((activity) => isRun(activity) && activity.movingTime > 0);
  if (runs.length === 0) return locked("no-runs", requiredKm);

  const recent = runs.filter((activity) => {
    const time = activity.startDate.getTime();
    return time <= nowMs && time >= nowMs - LOOKBACK_DAYS * DAY_MS;
  });
  if (recent.length === 0) return locked("stale-runs", requiredKm);

  const candidates = recent.filter((activity) => activity.distance >= requiredKm * 1000);
  if (candidates.length === 0) return locked("runs-too-short", requiredKm);

  const { hrMax, source: hrMaxSource } = hrCeiling(candidates, hrMaxOverride);

  // The best projection any recent effort supports — the runner's ceiling, not
  // the average of their easy days. Each projection is first discounted by the
  // effort its heart rate says it was run at (issue #116), so a fast-looking
  // easy run can't out-bid a genuinely hard one it never earned.
  let bestSeconds = Number.POSITIVE_INFINITY;
  let basisKm = 0;
  let hrAdjustment = 1;
  for (const run of candidates) {
    const ratio = (raceDistanceKm * 1000) / run.distance;
    const adjustment = hrAdjustmentFor(run, hrMax);
    const seconds = run.movingTime * ratio ** RIEGEL_EXPONENT * adjustment;
    if (seconds < bestSeconds) {
      bestSeconds = seconds;
      basisKm = run.distance / 1000;
      hrAdjustment = adjustment;
    }
  }

  return {
    prediction: {
      raceDistanceKm,
      timeSeconds: Math.round(bestSeconds),
      paceSecPerKm: Math.round(bestSeconds / raceDistanceKm),
      basisKm: Math.round(basisKm * 10) / 10,
      sampleRuns: candidates.length,
      confidence: confidenceFor(candidates.length, basisKm, raceDistanceKm),
      hrMax,
      hrMaxSource,
      hrAdjustment,
    },
    reason: null,
    message: null,
    requiredKm: null,
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
