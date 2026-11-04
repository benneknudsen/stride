// Stride — pure distance assembly for the workout recommender (issue #347).
// Steps 4–5 and the volume clamps: read the phase band, unlock its upper end on
// a measured pace-efficiency comparison, close a week's gap, and scale a run
// back when today would push the week past its budget. Returns the final type,
// distance and the reason lines in their original order.

import { getPhaseRules, type PhaseKey, type PhaseRules } from "@/lib/coach/engine";
import type { PaceEfficiencyTrend } from "@/lib/coach/recommender";
import { PAUSE_DAYS, type RunType, round1, type WeekBudget } from "@/lib/coach/recommender/risk";
import type { ProgressionSnapshot } from "@/lib/training/progression";

const PAUSE_DISTANCE_FACTOR = 0.8;

export interface DistanceInput {
  phase: PhaseKey;
  rules: PhaseRules;
  type: RunType;
  progression: ProgressionSnapshot;
  paceEfficiencyTrend?: PaceEfficiencyTrend;
  raceDate?: Date;
  longPause: boolean;
  week: WeekBudget;
}

export interface DistanceResult {
  type: RunType;
  distanceKm: number;
  reason: string[];
}

/** One decimal with a Danish decimal comma — "4,2", never "4.2". */
function decimalComma(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

/** Nearest half kilometre — the grid prescribed distances sit on. */
function roundHalf(km: number): number {
  return Math.round(km * 2) / 2;
}

/**
 * Steps 4–5 and the remaining volume clamps. Pure: same input, same distance
 * and the same reason lines in the same order.
 */
export function resolveDistance(input: DistanceInput): DistanceResult {
  const { phase, rules, week, progression } = input;
  let type = input.type;
  const reason: string[] = [];

  // B6: `readyToIncrease` is null when load data is missing — guard it to false
  // so a null never reads as "unlock the upper distance".
  const readyToIncrease = progression.readyToIncrease ?? false;
  // #336: the upper end unlocks on a MEASURED week-over-week comparison, never
  // on "a number exists" (`paceEfficiency !== null` only said there is a value).
  // "Not worse than last week" is read on the same one decimal the card prints,
  // so a change below that precision is noise.
  const trend = input.paceEfficiencyTrend;
  const comparison = trend
    ? { current: round1(trend.current), previous: round1(trend.previous) }
    : null;
  const paceEfficiencyNotWorse = comparison !== null && comparison.current >= comparison.previous;
  const readyForMore =
    readyToIncrease && progression.paceEfficiency !== null && paceEfficiencyNotWorse;

  let distanceKm: number;
  if (type === "long") {
    distanceKm = rules.longRunMaxKm;
    reason.push(`Ugens lange tur i ${phase}-fasen — op til ${rules.longRunMaxKm} km i Zone 2.`);
  } else if (readyForMore && comparison !== null) {
    distanceKm = rules.maxDistanceKm;
    reason.push(
      `Pace-effektiviteten er ikke faldet siden sidste uge (${decimalComma(comparison.current)} mod ${decimalComma(comparison.previous)}) og belastningen er optimal — klar til ${phase}-fasens øvre distance.`
    );
  } else {
    distanceKm = rules.minDistanceKm;
    reason.push(
      `Distance fra ${phase}-fasens bånd (${rules.minDistanceKm}–${rules.maxDistanceKm} km).`
    );
    // The comparison was made and it went the wrong way — say so, so the card
    // never leaves the runner guessing why the upper distance stayed shut.
    if (comparison !== null && !paceEfficiencyNotWorse) {
      reason.push(
        `Pace-effektiviteten er faldet siden sidste uge (${decimalComma(comparison.current)} mod ${decimalComma(comparison.previous)}) — ${phase}-fasens øvre distance er ikke låst op.`
      );
    }
  }

  // 3c (cont.) + #333: a week behind its plan may close the gap. The target is
  // clamped inside the phase band; the reason is held back until the clamps
  // below have had the final word.
  let weekGap: { targetKm: number; reason: string } | null = null;
  const weekToDateKm = week.weekToDateKm;
  const proratedWeeklyKm = week.proratedWeeklyKm;
  const weekBudgetKm = week.weekBudgetKm;
  const canCloseWeekGap =
    week.weekLoadKnown &&
    weekToDateKm !== null &&
    weekToDateKm < proratedWeeklyKm &&
    weekBudgetKm - weekToDateKm > rules.minDistanceKm + 1.0 &&
    (type === "easy" || type === "long");
  if (canCloseWeekGap) {
    const weekGapKm = weekBudgetKm - weekToDateKm;
    const gapDistanceKm = Math.min(
      rules.maxDistanceKm,
      Math.max(rules.minDistanceKm, roundHalf(weekGapKm))
    );
    if (gapDistanceKm > distanceKm) {
      distanceKm = gapDistanceKm;
      weekGap = {
        targetKm: gapDistanceKm,
        reason: `Du er ${round1(proratedWeeklyKm - weekToDateKm)} km bag ugens planlagte volumen indtil i dag (${round1(proratedWeeklyKm)} km) — dagens tur er derfor lidt længere, så ugen følger med.`,
      };
    }
  }

  // Edge: first runs — without a full history window, hold the adapt minimum.
  if (!progression.hasFullWindow) {
    distanceKm = Math.min(distanceKm, getPhaseRules("adapt", input.raceDate).minDistanceKm);
    reason.push("Under 4 ugers historik — vi starter forsigtigt på adapt-fasens minimum.");
  }

  // Edge: 14+ day pause — come back 20% shorter.
  if (input.longPause) {
    distanceKm = round1(distanceKm * PAUSE_DISTANCE_FACTOR);
    reason.push(`${PAUSE_DAYS}+ dages pause — distancen er sat 20% ned for en sikker genstart.`);
  }

  // B5: clamp band runs to the phase `maxDistanceKm`; a ready-to-progress
  // athlete may reach up to 15% beyond it. The long run has its own
  // `longRunMaxKm` ceiling and is exempt.
  if (type !== "long") {
    const upperBound = readyForMore ? round1(rules.maxDistanceKm * 1.15) : rules.maxDistanceKm;
    distanceKm = Math.min(distanceKm, upperBound);
  }

  // 3c (cont.). Today's session would push the week past its budget — scale it
  // down rather than let the week overshoot. Effort goes first: a tempo/long
  // becomes a rolig Zone 2-tur, and only if that alone doesn't fit does the
  // distance drop to the phase minimum. Never raises anything.
  if (week.weekLoadKnown && weekToDateKm !== null && weekToDateKm + distanceKm > weekBudgetKm) {
    if (type !== "easy") {
      const softened = type;
      type = "easy";
      distanceKm = Math.min(distanceKm, readyForMore ? rules.maxDistanceKm : rules.minDistanceKm);
      reason.push(
        `Du har løbet ${round1(weekToDateKm)} km af ugens ${round1(proratedWeeklyKm)} km — ${softened === "tempo" ? "tempopasset" : "den lange tur"} bliver en rolig Zone 2-tur, så ugen ikke stables med hårde dage.`
      );
    }
    if (weekToDateKm + distanceKm > weekBudgetKm) {
      distanceKm = Math.min(distanceKm, rules.minDistanceKm);
      reason.push(
        `Ugens volumen er næsten brugt (${round1(weekToDateKm)} af ${round1(proratedWeeklyKm)} km) — distancen holdes på ${phase}-fasens minimum på ${rules.minDistanceKm} km.`
      );
    }
  }

  // The week-gap line only stands if its raised distance survived every clamp.
  if (weekGap !== null && distanceKm === weekGap.targetKm) {
    reason.push(weekGap.reason);
  }

  return { type, distanceKm, reason };
}
