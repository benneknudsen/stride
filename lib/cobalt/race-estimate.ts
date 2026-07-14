// Cobalt Glass — race-time estimation.
// The plan pages used to ship hardcoded race numbers (goal 3:45, pace 5:20,
// "AI estimate" 3:41) for every user and every race. This module replaces them
// with values derived from the athlete's own recent runs: a Riegel prediction
// anchored on the longest recent run, against the race distance inferred from
// the race's name. Everything is pure and deterministic; when the inputs don't
// support an estimate (no runs, unknown distance) the callers render nothing
// rather than a made-up number.

const DAY_MS = 86_400_000;

/** How far back a run may lie and still anchor the prediction. */
const REFERENCE_WINDOW_DAYS = 42;

/** Runs shorter than this predict nothing about race endurance. */
const MIN_REFERENCE_METERS = 3000;

/** Riegel's fatigue exponent: T2 = T1 × (D2/D1)^1.06. */
const RIEGEL_EXPONENT = 1.06;

export interface RaceEstimate {
  /** The race distance the prediction is for, in km. */
  distanceKm: number;
  /** Predicted finish time in seconds. */
  seconds: number;
}

/** The activity fields the estimator reads — demo fixtures and DB rows both fit. */
export interface EstimateRunLike {
  /** Distance in meters. */
  distance: number;
  /** Moving time in seconds. */
  movingTime: number;
  startDate: Date;
}

/**
 * Best-effort race distance from the race's display name — the only distance
 * signal the product stores (issue #99 keeps just a date + name per user).
 * Unknown names return null and the race card simply shows no estimates.
 */
export function inferRaceDistanceKm(raceName: string | null | undefined): number | null {
  if (!raceName) return null;
  const name = raceName.toLowerCase();
  // "Halvmarathon", "half marathon", and bare "Half" ("CPH Half") all read as a
  // half marathon; any other "marathon" is the full distance.
  if (/\b(halv|half)/.test(name)) return 21.0975;
  if (/mara/.test(name)) return 42.195;
  const km = name.match(/(\d+(?:[.,]\d+)?)\s*k(?:m)?\b/);
  if (km) {
    const value = Number.parseFloat(km[1].replace(",", "."));
    if (value >= 1 && value <= 100) return value;
  }
  return null;
}

/**
 * Riegel prediction anchored on the longest qualifying run within the last
 * {@link REFERENCE_WINDOW_DAYS} days. The longest run is the standard anchor
 * for endurance prediction — a short fast interval says little about how a
 * half marathon will go.
 */
export function estimateRaceTime(
  runs: EstimateRunLike[],
  distanceKm: number,
  now: Date
): RaceEstimate | null {
  if (distanceKm <= 0) return null;
  const cutoff = now.getTime() - REFERENCE_WINDOW_DAYS * DAY_MS;

  let reference: EstimateRunLike | null = null;
  for (const run of runs) {
    if (run.startDate.getTime() < cutoff || run.startDate.getTime() > now.getTime()) continue;
    if (run.distance < MIN_REFERENCE_METERS || run.movingTime <= 0) continue;
    if (!reference || run.distance > reference.distance) reference = run;
  }
  if (!reference) return null;

  const referenceKm = reference.distance / 1000;
  const seconds = reference.movingTime * (distanceKm / referenceKm) ** RIEGEL_EXPONENT;
  return { distanceKm, seconds: Math.round(seconds) };
}

/** "1:56" above an hour (h:mm), else "58:12" (m:ss). */
export function formatRaceTime(totalSeconds: number): string {
  const total = Math.round(totalSeconds);
  if (total >= 3600) {
    const rounded = Math.round(total / 60);
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}`;
  }
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The estimate rounded UP to the next 5 minutes — an honest "under X" target. */
export function goalTimeFromEstimate(estimateSeconds: number): string {
  return formatRaceTime(Math.ceil(estimateSeconds / 300) * 300);
}

/** Average pace ("5:29") the predicted finish implies, per km. */
export function racePaceFromEstimate(estimate: RaceEstimate): string {
  const perKm = estimate.seconds / estimate.distanceKm;
  const minutes = Math.floor(perKm / 60);
  const seconds = Math.round(perKm % 60);
  if (seconds === 60) return `${minutes + 1}:00`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
