// Stride — what a run actually was (issue #333). One classifier for both coach
// cards: the recommender reads the last run's character, and "Næste aktivitet"
// reads the mix it leaves behind. Distance decides first — a 20 km run is the
// week's long run however hard the heart rate ran — then intensity: Z4–Z5 is a
// hard session, Z3 tempo, the rest easy. A run without heart rate reads as easy
// rather than inventing an intensity.
//
// Pure and deterministic: no clock, no randomness, no I/O.

import { MIN_RECOVERY_HOURS, type PhaseRules } from "@/lib/coach/engine";
import { type ActivityInput, dominantZone, isHardEffort } from "@/lib/training/effort";

/** How a past run is read: its training role, not its label in Strava. */
export type RunKind = "easy" | "tempo" | "long" | "hard";

/** The run fields the classifier reads; DB rows and fixtures both fit. */
export interface RunCharacterInput extends ActivityInput {
  /** Distance in meters. */
  distance: number;
}

/**
 * A run counts as "long" from this share of the phase's long-run ceiling
 * (`longRunMaxKm`) upward — 13 km in the base phases, 14,5 km in sharpen/peak,
 * 8 km in the taper. Phase-relative rather than a fixed number so the bar moves
 * with what the block actually asks for.
 */
const LONG_RUN_MIN_FACTOR = 0.8;

/** Prescribed distances sit on a half-km grid — "14,5 km", never "14,4 km". */
function roundHalf(km: number): number {
  return Math.round(km * 2) / 2;
}

/** The long-run bar for a phase — the one number both cards classify against. */
export function longRunThresholdKm(rules: PhaseRules): number {
  return roundHalf(rules.longRunMaxKm * LONG_RUN_MIN_FACTOR);
}

/** A past run's training role, longest signal first. */
export function classifyRun(run: RunCharacterInput, longThresholdKm: number): RunKind {
  if (run.distance / 1000 >= longThresholdKm) return "long";
  if (isHardEffort(run)) return "hard";
  return dominantZone(run) === 3 ? "tempo" : "easy";
}

/**
 * A break this long or longer restarts the day shape (#333): three days is the
 * point where the next run is a re-entry, not a continuation of the block. It
 * describes *today's form* after a short break — not the recommender's longer
 * {@link PAUSE_DAYS} window (14 days), which scales the whole restart down.
 */
export const PAUSE_RESTART_DAYS = 3;

/**
 * How long a hard or long run leaves residue in the legs (#333 repair): 48
 * hours, the app's own recovery window before a new hard session
 * ({@link MIN_RECOVERY_HOURS}). It is longer than the 24 h an easy run needs,
 * which is exactly the gap the character gate fills — a Z4–Z5 run or a long run
 * 30 h ago clears the 24 h buffer but not this one.
 */
export const STATE_RESIDUE_HOURS = MIN_RECOVERY_HOURS;

/** What the runner's state says about the shape of the day. */
export type DayShapeGate = "pause" | "hard-last" | "long-last";

/**
 * One state read shared by both coach cards (#333): after a pause of
 * {@link PAUSE_RESTART_DAYS} days or more the day restarts easy, and a hard
 * (Z4–Z5) or long last run inside {@link STATE_RESIDUE_HOURS} must not stack
 * another quality/long day on top. A Z3 tempo run does not gate — the app's own
 * model (`lib/training/effort.ts`) calls it quality work that does not owe the
 * body a 48 h window, so treating it as residue would delete ordinary plan
 * days. Unknown character never gates either — with nothing to classify, the
 * card must not invent a restriction. When the character is known, pause wins
 * over the residue read because it is the broader re-entry signal. The
 * recommender and the variation both call this; neither keeps its own copy of
 * the rule.
 */
export function dayShapeGate(opts: {
  /** The last run's character, or null when it is unknown. */
  character: RunKind | null;
  /** Hours since that run. */
  gapHours: number;
}): DayShapeGate | null {
  if (opts.character === null) return null;
  if (opts.gapHours >= PAUSE_RESTART_DAYS * 24) return "pause";
  if (opts.character === "hard" && opts.gapHours < STATE_RESIDUE_HOURS) return "hard-last";
  if (opts.character === "long" && opts.gapHours < STATE_RESIDUE_HOURS) return "long-last";
  return null;
}

/**
 * The Danish reason both cards show for a gate (#333). One formulation in one
 * place, so the two cards cannot explain the same day in two different ways.
 */
export function dayShapeReason(gate: DayShapeGate, gapHours: number): string {
  if (gate === "pause") {
    const pauseDays = Math.floor(gapHours / 24);
    return `Du har holdt pause i ${pauseDays} dage — vi starter let igen med en rolig tur i dag.`;
  }
  if (gate === "hard-last") {
    return "Din sidste tur var et hårdt pas — i dag bliver det en rolig tur, så benene har nået at restituere.";
  }
  return "Din sidste tur var en lang tur — benene har brug for en rolig dag i dag.";
}
