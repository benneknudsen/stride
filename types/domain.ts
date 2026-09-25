import type { activities, users } from "../drizzle/schema";

/**
 * Domain types. Database row types are inferred from the Drizzle schema so
 * they stay in sync with migrations; the structured JSON payloads (splits,
 * HR zones) are typed explicitly since they live in `jsonb` columns.
 */

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

/** A single split (per kilometer or mile) within an activity. */
export type Split = {
  /** 1-based split index. */
  index: number;
  /** Split distance in meters. */
  distance: number;
  /** Elapsed time for the split in seconds. */
  elapsedTime: number;
  /** Moving time for the split in seconds. */
  movingTime: number;
  /** Average speed in meters/second. */
  averageSpeed: number;
  /** Average heart rate in bpm, if recorded. */
  averageHeartrate?: number;
  /** Elevation change across the split in meters. */
  elevationDifference?: number;
  /** Strava grade-adjusted pace zone, if present. */
  paceZone?: number;
};

/** Time spent in a single heart-rate zone. */
export type HrZone = {
  /** Zone number (1–5). */
  zone: number;
  /** Lower bound of the zone in bpm. */
  min: number;
  /** Upper bound of the zone in bpm (null for the open-ended top zone). */
  max: number | null;
  /** Seconds spent in this zone. */
  seconds: number;
};

/** An activity row with the JSON columns narrowed to their domain types. */
export type Activity = Omit<typeof activities.$inferSelect, "splits" | "hrZones"> & {
  splits: Split[] | null;
  hrZones: HrZone[] | null;
};

// ---------------------------------------------------------------------------
// Analysis scope
// ---------------------------------------------------------------------------

/**
 * Scope of an analysis — which slice of data it reasons over. The coach is
 * computed in-process from the request's activities, so there is no table to
 * infer this from; it is the block-stream's own vocabulary.
 */
export type AnalysisScope = "weekly" | "activity" | "trend" | "overall";
