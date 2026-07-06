import type { AnalysisBlock } from "@/lib/ai/tools";
import { CoachInsight } from "./coach-insight";
import { InsightCard } from "./insight-card";
import { MetricComparison } from "./metric-comparison";
import { TrendCallout } from "./trend-callout";
import { WorkoutRecommendation } from "./workout-recommendation";

/**
 * The generic generative-UI renderer: maps a typed tool invocation to its
 * pre-defined component. The model decides *which* block to emit; this switch
 * decides *how* it looks. Adding a new tool means adding one schema (lib/ai/
 * tools.ts), one component, and one branch here — nothing in the model layer.
 */
export function AnalysisBlockView({ block }: { block: AnalysisBlock }) {
  switch (block.tool) {
    case "insightCard":
      return <InsightCard block={block} />;
    case "trendCallout":
      return <TrendCallout block={block} />;
    case "workoutRecommendation":
      return <WorkoutRecommendation block={block} />;
    case "metricComparison":
      return <MetricComparison block={block} />;
    case "coachInsight":
      return <CoachInsight block={block} />;
    default:
      return assertNever(block);
  }
}

/** Compile-time exhaustiveness guard — a new tool without a branch fails tsc. */
function assertNever(block: never): null {
  void block;
  return null;
}
