// Cobalt Glass — "hvad hvis" arithmetic (issue #340).
//
// The what-if card lets the runner point the predictor at another distance and
// read what their *current* basis reaches there — and how far their own goal
// sits from it. Everything here is arithmetic on numbers the view-model already
// derived: the goal time and the prediction's seconds. Nothing is projected and
// nothing is promised — the gap is the difference between two numbers, and the
// copy says only that.

import { formatRaceTime as formatClock } from "@/lib/cobalt/race-estimate";
import { formatPaceClock } from "@/lib/training/prediction";

/** Which way the goal sits against the prediction. */
export type GapDirection = "faster" | "slower" | "even";

export interface GoalGap {
  /** Signed seconds between the goal and the prediction — negative when the goal is faster. */
  seconds: number;
  /** The same gap per km, in whole seconds — negative when the goal is faster. */
  secondsPerKm: number;
  /** The goal's own pace, in seconds per km. */
  goalPaceSecPerKm: number;
  /** Which way the goal sits against the prediction. */
  direction: GapDirection;
}

/** The distance between a goal time and a prediction, over a distance. */
export function goalGap(
  goalSeconds: number,
  predictionSeconds: number,
  distanceKm: number
): GoalGap {
  const seconds = goalSeconds - predictionSeconds;
  const hasDistance = distanceKm > 0;
  const perKm = hasDistance ? seconds / distanceKm : 0;
  const rounded = Math.round(perKm);
  return {
    seconds,
    // -0 and 0 are the same gap; normalise so the copy never sees a signed zero.
    secondsPerKm: rounded === 0 ? 0 : rounded,
    goalPaceSecPerKm: hasDistance ? goalSeconds / distanceKm : 0,
    direction: seconds < 0 ? "faster" : seconds > 0 ? "slower" : "even",
  };
}

/**
 * The sentence that tells the runner which way the goal sits against the
 * prediction. It states the difference and nothing else — no claim that
 * training, volume or time would close it.
 */
export function gapSentence(gap: GoalGap): string {
  if (gap.direction === "even") return "Målet ligger præcis på din prognose.";
  const perKm = Math.abs(gap.secondsPerKm);
  if (perKm === 0) {
    // Under half a second per km — the seconds say it better than the pace does.
    return `Målet afviger ${Math.abs(gap.seconds)} sekunder fra din prognose.`;
  }
  return gap.direction === "faster"
    ? `Målet kræver ${perKm} sek/km hurtigere end din prognose.`
    : `Du har ${perKm} sek/km i hus — målet er langsommere end din prognose.`;
}

/** The same gap as a whole time ("5:00"). */
export function gapDuration(gap: GoalGap): string {
  return formatClock(Math.abs(gap.seconds));
}

/** The goal's own pace as a clock ("4:30"). */
export function goalPaceLabel(gap: GoalGap): string {
  if (gap.goalPaceSecPerKm <= 0) return "—";
  return formatPaceClock(gap.goalPaceSecPerKm);
}

/** A goal time in the app's clock ("1:38"). */
export function goalClock(goalSeconds: number): string {
  return formatClock(goalSeconds);
}
