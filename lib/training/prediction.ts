// Stride — race-time prediction engine.
//
// Turns a runner's recent efforts into a projected finish time for their target
// race, using Peter Riegel's endurance model — the same race-equivalence
// formula behind most published race calculators:
//
//     T2 = T1 × (D2 ÷ D1) ^ 1.06
//
// A performance over one distance predicts the equivalent performance over
// another; the exponent (1.06) encodes how much pace fades as distance grows.
// We project every qualifying recent run to the race distance and take the
// fastest projection as the runner's current potential — then round it up to a
// clean goal the estimate can beat.
//
// Like the rest of the coach engine this is pure, deterministic and needs no AI
// key, so the public demo renders a real, data-grounded prediction rather than a
// hardcoded number (mirrors the heuristic fallback in lib/ai/analysis.ts).

const DAY_MS = 24 * 60 * 60 * 1000;

/** Riegel's fatigue exponent. 1.06 is his empirical fit for trained runners. */
const RIEGEL_EXPONENT = 1.06;

/** Prefer efforts from the last 6 weeks; older form is stale. */
const RECENCY_DAYS = 42;

/** Round the motivating goal up to the nearest 5 minutes. */
const GOAL_ROUNDING_SECONDS = 5 * 60;

/**
 * The most an easy run's pace may be scaled toward race intensity (issue: real
 * training is mostly easy — see below). The pace↔HR relationship is roughly
 * linear only over a modest range; beyond ~10% the linear model over-promises
 * and we simply lack the data to claim more, so we cap the credit and lower the
 * confidence. Cross-validated against an independent 14-day model: on a real
 * easy-base history this cap projects a marathon within that model's range,
 * where the uncapped Riegel projection fell well outside it.
 */
const MAX_EFFORT_GAIN = 1.1;

const HALF_MARATHON_M = 21_097.5;
const MARATHON_M = 42_195;

/**
 * Race intensity as a fraction of max HR, by distance — the effort a trained
 * runner holds for that race (5k ≈ 0.95, 10k ≈ 0.92, half ≈ 0.88, marathon ≈
 * 0.82). Efforts run easier than this are submaximal and under-represent race
 * ability; {@link effortMultiplier} scales them up toward it.
 */
const RACE_EFFORT_ANCHORS: [meters: number, fraction: number][] = [
  [5000, 0.95],
  [10_000, 0.92],
  [HALF_MARATHON_M, 0.88],
  [MARATHON_M, 0.82],
];

/** The minimal per-activity fields the prediction reads — a subset of an `activities` row. */
export interface PredictionActivity {
  /** Strava activity type, e.g. "Run", "TrailRun", "Ride". */
  type: string;
  /** Distance in meters. */
  distance: number;
  /** Moving time in seconds. */
  movingTime: number;
  /** Activity start. */
  startDate: Date;
  /** Average heart rate (bpm), if recorded — drives the effort adjustment. */
  averageHeartrate?: number | null;
  /** Max heart rate (bpm), if recorded — feeds the athlete's observed HR ceiling. */
  maxHeartrate?: number | null;
}

/** How much to trust an estimate — driven by data volume and the distance gap. */
export type PredictionConfidence = "low" | "medium" | "high";

export interface RacePrediction {
  /** Predicted finish time for the target race, in seconds. */
  predictedSeconds: number;
  /** Predicted average race pace, in seconds per km. */
  racePaceSecPerKm: number;
  /** A round, motivating goal (a hair softer than the estimate), in seconds. */
  goalSeconds: number;
  /** The single effort the estimate is projected from. */
  basis: {
    distanceKm: number;
    paceSecPerKm: number;
    /** Whole days ago the effort was run. */
    daysAgo: number;
  };
  confidence: PredictionConfidence;
  /** Number of qualifying efforts considered. */
  sampleSize: number;
  targetDistanceKm: number;
  /**
   * True when the basis was an easy run whose pace we scaled up toward race
   * intensity — i.e. the estimate leans on effort adjustment, not a run raced
   * near race pace. Caps confidence at "medium" and flags the UI note.
   */
  effortAdjusted: boolean;
}

/** Running activity types: "Run", "TrailRun", "VirtualRun", … */
function isRun(activity: PredictionActivity): boolean {
  return /run/i.test(activity.type);
}

/** Race intensity (fraction of max HR) for a distance, linearly interpolated. */
function raceEffortFraction(distanceMeters: number): number {
  const anchors = RACE_EFFORT_ANCHORS;
  if (distanceMeters <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (distanceMeters >= last[0]) return last[1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [d0, e0] = anchors[i];
    const [d1, e1] = anchors[i + 1];
    if (distanceMeters <= d1) return e0 + ((e1 - e0) * (distanceMeters - d0)) / (d1 - d0);
  }
  return last[1];
}

/**
 * The athlete's HR ceiling — the max recorded across their runs (max HR beats
 * average HR when both exist). Null when no run carries HR, which turns off the
 * effort adjustment (fall back to raw Riegel).
 */
function observedHrMax(activities: PredictionActivity[]): number | null {
  let ceiling = 0;
  for (const a of activities) {
    ceiling = Math.max(ceiling, a.maxHeartrate ?? 0, a.averageHeartrate ?? 0);
  }
  return ceiling > 0 ? ceiling : null;
}

/**
 * How much to scale a run's pace toward race intensity, in [1, MAX_EFFORT_GAIN].
 * A run at or above race effort is left as-is (Riegel handles the distance);
 * an easier run is credited the HR ratio, capped. Returns 1 without HR data.
 */
function effortMultiplier(
  activity: PredictionActivity,
  targetEffort: number,
  hrMax: number | null
): number {
  const avgHr = activity.averageHeartrate ?? 0;
  if (hrMax === null || avgHr <= 0) return 1;
  const effort = avgHr / hrMax;
  if (effort <= 0 || effort >= targetEffort) return 1;
  return Math.min(targetEffort / effort, MAX_EFFORT_GAIN);
}

/**
 * Best-effort race distance (meters) from a free-text race name. "Halvmarathon"
 * is checked before "marathon" because it contains it; a bare "10K"/"5 km" is
 * read numerically. Defaults to a half marathon — the demo race (issue #99 keeps
 * the real distance per user, but the DB stores only a name + date).
 */
export function inferRaceDistanceMeters(raceName?: string | null): number {
  const name = (raceName ?? "").toLowerCase();
  if (/(halv|half)/.test(name)) return HALF_MARATHON_M;
  if (/marat(h)?on/.test(name)) return MARATHON_M;
  const km = name.match(/(\d+(?:[.,]\d+)?)\s*k/);
  if (km) {
    const value = Number.parseFloat(km[1].replace(",", "."));
    if (value > 0 && value <= 200) return value * 1000;
  }
  return HALF_MARATHON_M;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Project `activities` onto `targetDistanceMeters` via Riegel and return the
 * runner's current potential (fastest projection), or null when no effort is
 * substantial enough to project from. Recent form is preferred; if the trailing
 * 6-week window is empty the whole history is considered.
 *
 * `now` is injected so tests (and the deterministic demo) are reproducible.
 */
export function predictRace(
  activities: PredictionActivity[],
  targetDistanceMeters: number,
  now: Date = new Date()
): RacePrediction | null {
  if (targetDistanceMeters <= 0) return null;

  // The basis effort must be a real endurance run proportional to the race, so a
  // parkrun sprint can't set a marathon prediction. Floor at 3 km.
  const minBasisMeters = Math.max(3000, targetDistanceMeters * 0.25);
  const nowMs = now.getTime();

  const eligible = (windowDays: number) =>
    activities.filter(
      (a) =>
        isRun(a) &&
        a.distance >= minBasisMeters &&
        a.movingTime > 0 &&
        a.startDate.getTime() <= nowMs &&
        (windowDays === 0 || a.startDate.getTime() >= nowMs - windowDays * DAY_MS)
    );

  let candidates = eligible(RECENCY_DAYS);
  if (candidates.length === 0) candidates = eligible(0);
  if (candidates.length === 0) return null;

  // Effort-adjust each candidate's pace toward race intensity (real training is
  // mostly easy, and raw Riegel treats an easy run as a maximal one), then
  // project it. The fastest adjusted projection is the current race ceiling.
  const hrMax = observedHrMax(activities);
  const targetEffort = raceEffortFraction(targetDistanceMeters);

  let best = candidates[0];
  let bestSeconds = Number.POSITIVE_INFINITY;
  let bestMultiplier = 1;
  for (const a of candidates) {
    const adjustedTime = a.movingTime / effortMultiplier(a, targetEffort, hrMax);
    const projected = adjustedTime * (targetDistanceMeters / a.distance) ** RIEGEL_EXPONENT;
    if (projected < bestSeconds) {
      bestSeconds = projected;
      best = a;
      bestMultiplier = a.movingTime / adjustedTime;
    }
  }

  const predictedSeconds = Math.round(bestSeconds);
  const targetKm = targetDistanceMeters / 1000;
  const racePaceSecPerKm = Math.round(predictedSeconds / targetKm);

  const basisKm = best.distance / 1000;
  const daysAgo = Math.max(0, Math.round((nowMs - best.startDate.getTime()) / DAY_MS));
  const effortAdjusted = bestMultiplier > 1.001;

  // Confidence rises with the sample and with how close the basis effort's
  // distance is to the race — projecting a marathon off a 10 km run is a longer
  // reach than off a 30 km run. An estimate leaning on effort adjustment (an
  // easy run scaled up, no run raced near race pace) is capped at "medium".
  const distanceRatio = best.distance / targetDistanceMeters;
  const confidence: PredictionConfidence =
    distanceRatio >= 0.5 && candidates.length >= 6 && !effortAdjusted
      ? "high"
      : distanceRatio >= 0.3 || candidates.length >= 3
        ? "medium"
        : "low";

  return {
    predictedSeconds,
    racePaceSecPerKm,
    goalSeconds: Math.ceil(predictedSeconds / GOAL_ROUNDING_SECONDS) * GOAL_ROUNDING_SECONDS,
    basis: {
      distanceKm: round1(basisKm),
      // The pace the runner actually ran — honest ("from your 6.2 km @ 7:19");
      // effortAdjusted flags that the estimate credits a faster race pace.
      paceSecPerKm: Math.round(best.movingTime / basisKm),
      daysAgo,
    },
    confidence,
    sampleSize: candidates.length,
    targetDistanceKm: round1(targetKm),
    effortAdjusted,
  };
}

/**
 * Format a finish time: `H:MM` once it reaches an hour (the big-number race-card
 * style — no seconds), else `M:SS` (a fast 5 km stays legible).
 */
export function formatRaceTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}`;
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

/** Format a pace (seconds per km) as `M:SS`. */
export function formatPaceClock(secondsPerKm: number): string {
  const total = Math.max(0, Math.round(secondsPerKm));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
