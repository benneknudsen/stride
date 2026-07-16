// Stride — progression metrics engine (issue #30), DB-backed entry point.
//
// The pure calculation layer lives in lib/training/progression-core.ts (so the
// Cobalt view-models — which client components import — can share it without
// pulling lib/db into the browser bundle) and is re-exported here unchanged:
// server code keeps importing everything from this module. `getProgression`
// and `getCurrentProgression` are the thin DB-backed wrappers.

import { getActivities } from "@/lib/db/queries";
import {
  computeProgression,
  computeSnapshot,
  isRun,
  type ProgressionActivityInput,
  type ProgressionSnapshot,
  WINDOW_DAYS,
} from "@/lib/training/progression-core";

export * from "@/lib/training/progression-core";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fetch enough history to cover `weeks` of snapshots plus each one's 4-week
 * window, and one extra window beyond that. The margin is what lets
 * `hasFullWindow` flip true: it needs a run OLDER than the oldest snapshot's
 * window, and fetching exactly to the window edge would make the earliest
 * fetched run at most `WINDOW_DAYS` old — leaving the flag permanently false.
 */
async function fetchRuns(userId: string, weeks: number, asOf: Date) {
  const from = new Date(asOf.getTime() - (weeks * 7 + 2 * WINDOW_DAYS) * DAY_MS);
  const rows = await getActivities(userId, { from, to: asOf, limit: 1000 });
  return (rows as ProgressionActivityInput[]).filter(isRun);
}

/** Progression time series for a user: one snapshot per week, oldest first. */
export async function getProgression(userId: string, weeks = 12): Promise<ProgressionSnapshot[]> {
  const asOf = new Date();
  return computeProgression(await fetchRuns(userId, weeks, asOf), weeks, asOf);
}

/** The user's progression right now — a single up-to-date snapshot. */
export async function getCurrentProgression(userId: string): Promise<ProgressionSnapshot> {
  const asOf = new Date();
  return computeSnapshot(await fetchRuns(userId, 0, asOf), asOf);
}
