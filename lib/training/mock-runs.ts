// Stride — seeded mock run fixtures for the committed training dashboard.
//
// These are the raw, plan-independent samples the dashboard renders against so
// it works without a Strava connection (see the demo-mode note in CLAUDE.md).
// They sit *behind* the typed data layer in `runs.ts`: the UI never imports
// these directly — it calls `getTrainingData`, so swapping these fixtures for a
// real Strava query later changes nothing downstream.

import type { LatestRun, PastRun } from "./runs";

/** The most recent run shown in section "01 Latest run". */
export const LATEST_RUN: LatestRun = {
  title: "Morning Run",
  when: "Today, 7:02 AM",
  distanceKm: 10.2,
  duration: "52:18",
  pace: "5:08",
  avgHr: 148,
  cadence: 182,
  elevGain: 124,
  paceTrace: [40, 36, 44, 30, 34, 28, 38, 26, 32, 22, 30, 24, 34, 30, 26],
  zoneDistribution: { z1: 6, z2: 72, z3: 14, z4: 6, z5: 2 },
};

/** The trailing five runs behind section "02 Last 5 runs". */
export const PAST_RUNS: PastRun[] = [
  { day: "Mon", distanceKm: 8.0, pace: "5:14", zone: "z2" },
  { day: "Tue", distanceKm: 6.2, pace: "5:32", zone: "z2" },
  { day: "Thu", distanceKm: 12.5, pace: "5:20", zone: "z2" },
  { day: "Fri", distanceKm: 5.0, pace: "4:48", zone: "z3" },
  { day: "Sun", distanceKm: 10.2, pace: "5:08", zone: "z2" },
];

/** Mon-indexed position of "today" and the next planned session in the week
 * strip under section "03 Recommended next run". */
export const TODAY_INDEX = 2;
export const NEXT_INDEX = 3;
