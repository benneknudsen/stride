import type { activities, aiAnalyses, users } from "../drizzle/schema";

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

/** An activity guaranteed to carry its splits (e.g. on the detail page). */
export type ActivityWithSplits = Activity & {
  splits: Split[];
};

// ---------------------------------------------------------------------------
// AI analyses
// ---------------------------------------------------------------------------

/** Scope of an AI analysis — which slice of data it reasons over. */
export type AnalysisScope = (typeof aiAnalyses.$inferSelect)["scope"];

/** A single generative-UI tool invocation persisted with an analysis. */
export type AnalysisToolCall = {
  /** Tool name, e.g. "showTrend" | "showInsight". */
  name: string;
  /** Validated arguments the component was rendered with. */
  args: Record<string, unknown>;
};

export type Analysis = Omit<typeof aiAnalyses.$inferSelect, "toolCalls"> & {
  toolCalls: AnalysisToolCall[] | null;
};
