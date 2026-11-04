// Cobalt Glass — Plan prescriptions.
//
// The phase-aware distances and pace targets the plan asks of the runner: how
// much of the phase's prescription they can absorb this week, and the three run
// suggestions (easy / quality / long) that carry those numbers.

import {
  DEFAULT_RACE_DATE,
  getPhaseRules,
  MAX_WEEKLY_INCREASE_RATIO,
  type PhaseKey,
  type PlannedSession,
} from "@/lib/coach/engine";
import type { HomeActivityLike } from "@/lib/cobalt/hjem";
import { getWeeklyVolume } from "@/lib/metrics";
import { formatPaceClock, type PaceZone } from "@/lib/training/prediction";
import { computeSnapshot } from "@/lib/training/progression-core";

/** The three run types the plan suggests each week (issue #244). */
export type SuggestionType = "easy" | "tempo" | "long";

/**
 * One of the week's three run suggestions (issue #244). Day-agnostic: it names a
 * kind of run, its phase distance and its pace target, but never *which* day —
 * the coach decides that. `min`/`max` are the pace range's fast/slow ends,
 * already formatted ("8:10"/"8:30").
 */
export interface RunSuggestion {
  type: SuggestionType;
  /** Danish label, mono uppercase in the UI ("Let pas" / "Kvalitetspas" / "Langtur"). */
  label: string;
  /** Distance in km, from the phase rules (`getPhaseRules`). */
  distanceKm: number;
  /** Target pace range, min (fast) → max (slow), formatted "m:ss". */
  paceRange: { min: string; max: string };
  /** Plain-language description ("Rolig restitution" / "Tempo · hårdt" / "Lang tur · moderat"). */
  description: string;
}

/** The colour a session wears, so the UI never re-derives it from a type string. */
export type SessionTone = "long" | "quality" | "easy" | "race";

/**
 * Half-width of a pace-target range when the prediction is low-confidence (issue
 * #231) — wider than the default so the plan shows honest uncertainty rather than
 * fake precision on a target it rests one run on.
 */
export const LOW_CONFIDENCE_PACE_SPREAD = 25;

/** Default half-width of a pace-target range, in seconds ("MÅL 8:10–8:30"). */
export const PACE_RANGE_SPREAD = 10;

/** Targets are prescribed on a half-km grid — "7,5 km", never "7,4 km". */
export function roundHalfKm(km: number): number {
  return Math.round(km * 2) / 2;
}

/**
 * How much of the phase's prescription the runner can actually absorb this week.
 * Never scales *up* — the phase rules are the ceiling — and never asks for more
 * than {@link MAX_WEEKLY_INCREASE_RATIO} on top of last week's real volume, with
 * the load ratio (`computeSnapshot`) tightening that further when the acute:chronic
 * band says the runner is already carrying too much.
 */
export function volumeScale(runs: HomeActivityLike[], now: Date, prescribedKm: number): number {
  if (prescribedKm <= 0) return 1;
  const lastWeekKm = getWeeklyVolume(runs, 1, now) / 1000;
  if (lastWeekKm <= 0) return 1;

  const risk = computeSnapshot(
    runs.map((run) => ({ ...run, hrZones: null })),
    now
  ).trainingLoad.risk;
  const growthCap = risk === "high" ? 0.9 : risk === "elevated" ? 1 : MAX_WEEKLY_INCREASE_RATIO;

  const targetKm = Math.min(prescribedKm, lastWeekKm * growthCap);
  // Floored: a single missed week shouldn't collapse the plan to nothing.
  return Math.max(0.6, Math.min(1, targetKm / prescribedKm));
}

/**
 * One session's contribution to a week's volume: its distance, scaled to what the
 * runner can absorb this week. Race day is the one session that is not a
 * prescription but a fact about the event, so it keeps its real distance — scaled,
 * a 21,1 km half marathon would be prescribed as a 14 km race (issue #291).
 */
export function prescribedDistance(session: PlannedSession, weekScale: number): number {
  const km = session.distanceKm ?? 0;
  return session.type === "race" ? km : km * weekScale;
}

/** Total prescribed distance across a generated week, race day unscaled. */
export function prescribedWeekKm(sessions: PlannedSession[], weekScale = 1): number {
  return sessions.reduce((sum, session) => sum + prescribedDistance(session, weekScale), 0);
}

/** A pace (seconds/km) as a fast→slow range around its centre, formatted "m:ss". */
function paceRangeOf(secondsPerKm: number, spread: number): { min: string; max: string } {
  return {
    min: formatPaceClock(secondsPerKm - spread),
    max: formatPaceClock(secondsPerKm + spread),
  };
}

/**
 * The week's three run suggestions for a phase (issue #244). Distances come from
 * the phase rules — the same numbers `getWeekPlan` assigns to weekdays, but pulled
 * out per run *type* instead of per day: the easy run sits at the phase's mid
 * distance, the quality run at its session ceiling (`maxDistanceKm`), the long run
 * at its long-run ceiling (`longRunMaxKm`). Paces come from the zone grid
 * (`zonePaces`), so recovery/easy → easy target, tempo → quality target, long →
 * long target. `spread` widens the range under low confidence (issue #231).
 */
export function buildRunSuggestions(
  phase: PhaseKey,
  paces: Record<PaceZone, number>,
  raceDate: Date = DEFAULT_RACE_DATE,
  spread: number = PACE_RANGE_SPREAD
): RunSuggestion[] {
  const rules = getPhaseRules(phase, raceDate);
  const easyKm = roundHalfKm((rules.minDistanceKm + rules.maxDistanceKm) / 2);
  return [
    {
      type: "easy",
      label: "Let pas",
      distanceKm: easyKm,
      paceRange: paceRangeOf(paces.easy, spread),
      description: "Rolig restitution",
    },
    {
      type: "tempo",
      label: "Kvalitetspas",
      distanceKm: rules.maxDistanceKm,
      paceRange: paceRangeOf(paces.tempo, spread),
      description: "Tempo · hårdt",
    },
    {
      type: "long",
      label: "Langtur",
      distanceKm: rules.longRunMaxKm,
      paceRange: paceRangeOf(paces.long, spread),
      description: "Lang tur · moderat",
    },
  ];
}

/**
 * How the plan prints one kind of run: its Danish label, the colour it wears,
 * and the zone it is paced by. `zone: null` means the session has no pace target
 * — race day is a finish time, not a pace. Anything the engine adds later falls
 * back to the easy kind rather than falling out of the row.
 */
export const SESSION_KINDS: Record<
  string,
  { label: string; tone: SessionTone; zone: PaceZone | null }
> = {
  race: { label: "Race", tone: "race", zone: null },
  long: { label: "Langtur", tone: "long", zone: "long" },
  tempo: { label: "Kvalitetspas", tone: "quality", zone: "tempo" },
  easy: { label: "Rolig tur", tone: "easy", zone: "easy" },
};

export const DEFAULT_SESSION_KIND = SESSION_KINDS.easy;
