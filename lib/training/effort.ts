// Stride — the shared hard-effort classifier (issue #259).
//
// "Was that a hard run, and how long ago?" is asked in three places now — the
// "Næste aktivitet" variation reads it to classify the last five runs, and the
// Form-status/readiness cap reads it to refuse "Klar til hårdt pas" in the
// hours right after a threshold session. Before this module each caller would
// have invented its own rule; here there is exactly one.
//
// Intensity comes from `aggregateZones`, the one heart-rate→zone model the whole
// app shares (Strava's `hrZones` buckets when present, otherwise the zone the
// average heart rate implies), so a run is never classified by a rule invented
// at the call site.
//
// Pure and deterministic: the clock is a parameter, nothing here reads
// `Date.now()` or `Math.random()`, so the same input always yields the same
// answer on the server and in the browser.

import { ensureDate } from "@/lib/db/calendar-date";
import { aggregateZones, type ZoneActivityInput, type ZoneNumber } from "@/lib/training/zones";

const HOUR_MS = 3_600_000;

/**
 * From this dominant zone upward a run counts as a hard effort: Zone 4
 * (tærskel) and Zone 5 (VO2 max). Zone 3 is tempo — quality, but not the kind
 * of session that owes the body a 48 h recovery window.
 */
export const HARD_EFFORT_MIN_ZONE = 4;

/**
 * How far back {@link hoursSinceHardEffort} looks. A week: far enough past the
 * 48 h recovery window that every caller gets a real answer, short enough that
 * a hard session from last month never reads as "recent".
 */
export const HARD_EFFORT_LOOKBACK_HOURS = 7 * 24;

/**
 * The activity fields the classifier reads. `startDate` is widened to
 * `Date | string` because the Neon driver hands `timestamp` columns back as ISO
 * strings (see `ProgressionActivityInput`); every read goes through
 * `ensureDate`. Everything else comes from {@link ZoneActivityInput}, so demo
 * fixtures, DB rows and progression inputs all fit unchanged.
 */
export interface ActivityInput extends ZoneActivityInput {
  startDate: Date | string;
}

/**
 * The zone a single run spent most of its time in, via the shared aggregator.
 * Null when the run carries no heart-rate data at all — an unknown intensity,
 * never a fabricated one.
 */
export function dominantZone(run: ActivityInput): ZoneNumber | null {
  const { slices, totalSeconds } = aggregateZones([run]);
  if (totalSeconds === 0) return null;
  return slices.reduce((top, slice) => (slice.seconds > top.seconds ? slice : top)).meta.zone;
}

/**
 * Whether a run was a hard effort — dominant zone {@link HARD_EFFORT_MIN_ZONE}
 * or above. A run without heart rate reads as *not* hard rather than inventing
 * an intensity, the same call `classifyRun` has always made.
 */
export function isHardEffort(run: ActivityInput): boolean {
  const zone = dominantZone(run);
  return zone !== null && zone >= HARD_EFFORT_MIN_ZONE;
}

/**
 * Hours since the runner's most recent hard effort, or null when there is none
 * within {@link HARD_EFFORT_LOOKBACK_HOURS} (including the cold start: no runs
 * at all, or no run with heart-rate data). Runs in the future — a fixture set
 * read against an earlier clock — are ignored rather than counted as negative
 * hours.
 *
 * Callers pass runs only; this makes no judgement about activity type.
 */
export function hoursSinceHardEffort(runs: ActivityInput[], now: Date): number | null {
  const newestFirst = runs
    .filter((run) => ensureDate(run.startDate).getTime() <= now.getTime())
    .sort((a, b) => ensureDate(b.startDate).getTime() - ensureDate(a.startDate).getTime());

  for (const run of newestFirst) {
    const hours = (now.getTime() - ensureDate(run.startDate).getTime()) / HOUR_MS;
    // Sorted newest-first, so once one run falls outside the window every
    // remaining one does too.
    if (hours > HARD_EFFORT_LOOKBACK_HOURS) return null;
    if (isHardEffort(run)) return hours;
  }
  return null;
}
