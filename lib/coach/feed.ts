// Stride — coach-feed helpers (issue #34). The pure seam between the client
// feed component and the streaming `/api/ai/analyze` endpoint: build the
// request payload from the athlete's activities, and validate each streamed
// NDJSON line into a typed analysis block.
//
// Kept pure and framework-free so the wire contract is unit-testable without a
// running server — the component (CoachFeed.tsx) just does the fetch + I/O.

import { type AnalysisBlock, analysisBlockSchema } from "@/lib/ai/tools";
import type { AnalysisScope } from "@/types/domain";

/**
 * The coach feed asks for a trend-scoped analysis: the progression context the
 * issue calls for, so the endpoint's coach-insight cards reason over the rolling
 * training trend rather than a single activity.
 */
export const COACH_FEED_SCOPE: AnalysisScope = "trend";

/** The activity fields the feed forwards to the analyze endpoint. */
export interface CoachFeedActivityInput {
  startDate: Date | string;
  distance: number;
  movingTime: number;
  averageSpeed?: number | null;
  averageHeartrate?: number | null;
  totalElevationGain?: number | null;
}

/** The wire-shaped request the analyze endpoint validates (see its zod schema). */
export interface CoachFeedRequest {
  scope: AnalysisScope;
  activities: {
    startDate: string;
    distance: number;
    movingTime: number;
    averageSpeed: number | null;
    averageHeartrate: number | null;
    totalElevationGain: number | null;
  }[];
}

/** Build the trend-scoped analyze request from an activity history. */
export function buildCoachFeedRequest(activities: CoachFeedActivityInput[]): CoachFeedRequest {
  return {
    scope: COACH_FEED_SCOPE,
    activities: activities.map((a) => ({
      startDate: typeof a.startDate === "string" ? a.startDate : a.startDate.toISOString(),
      distance: a.distance,
      movingTime: a.movingTime,
      averageSpeed: a.averageSpeed ?? null,
      averageHeartrate: a.averageHeartrate ?? null,
      totalElevationGain: a.totalElevationGain ?? null,
    })),
  };
}

/**
 * Validate one NDJSON line from the stream into a typed block, or null. Blank
 * lines, half-flushed chunks (invalid JSON), and shapes that fail the block
 * schema are all dropped — the feed only ever renders validated blocks.
 */
export function parseFeedLine(line: string): AnalysisBlock | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = analysisBlockSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
