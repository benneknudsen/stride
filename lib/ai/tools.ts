/**
 * Typed generative-UI tools — the contract between the model and the UI.
 *
 * The model never emits free-form markup. Instead it invokes one of these
 * typed tools, and the analysis panel renders the matching pre-defined
 * component (see `components/ai/analysis-block.tsx`). Each tool's input schema
 * is the single source of truth: it drives the model's structured output, the
 * runtime validation, and the React component props.
 *
 * Future dashboard cards (#26 Zone Breakdown, etc.) extract from this pattern —
 * add a tool schema here, a component in `components/ai/`, and a branch in the
 * renderer.
 */

import { tool } from "ai";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const sentimentSchema = z.enum(["positive", "neutral", "caution"]);
export type Sentiment = z.infer<typeof sentimentSchema>;

export const trendDirectionSchema = z.enum(["up", "down", "flat"]);
export type TrendDirection = z.infer<typeof trendDirectionSchema>;

export const coachInsightTypeSchema = z.enum(["insight", "warning", "milestone"]);
export type CoachInsightType = z.infer<typeof coachInsightTypeSchema>;

/** One progression metric rendered inside a coach insight — a labelled value with a trend arrow. */
export const progressionPointSchema = z.object({
  label: z.string().describe("Metric name, e.g. 'Load ratio' or '4-week volume'"),
  value: z.string().describe("The metric's current value with unit, e.g. '1.62' or '104 km'"),
  direction: trendDirectionSchema.describe("Which way the metric is trending"),
  changeLabel: z.string().optional().describe("Optional signed change, e.g. '+38%'"),
});
export type ProgressionPoint = z.infer<typeof progressionPointSchema>;

// ---------------------------------------------------------------------------
// Tool input schemas — one per pre-defined component
// ---------------------------------------------------------------------------

/** Headline observation grounded in the athlete's data. */
export const insightCardSchema = z.object({
  title: z.string().describe("Short headline, ≤ 6 words"),
  body: z.string().describe("One or two sentences explaining the insight, grounded in the data"),
  sentiment: sentimentSchema.describe(
    "Tone: positive (good), neutral (informational), caution (watch out)"
  ),
  metric: z
    .string()
    .optional()
    .describe("Optional headline figure to spotlight, e.g. '52.4 km' or '5:18 /km'"),
});

/** A directional trend over recent weeks. */
export const trendCalloutSchema = z.object({
  title: z.string().describe("What is trending, ≤ 6 words, e.g. 'Weekly volume'"),
  direction: trendDirectionSchema.describe("up = increasing, down = decreasing, flat = steady"),
  changeLabel: z.string().describe("Human change label, e.g. '+18%' or '−0:12 /km'"),
  body: z.string().describe("One sentence on what the trend means for the athlete"),
  metric: z.string().describe("The current value of the metric, e.g. '48 km/week'"),
});

/** A concrete next-session recommendation. */
export const workoutRecommendationSchema = z.object({
  title: z.string().describe("Workout name, e.g. 'Tempo intervals'"),
  workoutType: z
    .string()
    .describe("Category label, e.g. 'Tempo', 'Long run', 'Recovery', 'Intervals'"),
  details: z.string().describe("The session prescription, e.g. '5 × 1 km @ 4:40 with 90s jog'"),
  rationale: z.string().describe("One sentence on why this fits the athlete right now"),
  targetPace: z.string().optional().describe("Optional target pace, e.g. '4:40 /km'"),
  distanceKm: z
    .number()
    .positive()
    .max(60)
    .optional()
    .describe("Optional total session distance in km (must be a realistic 0–60 km)"),
});

/** A head-to-head comparison of one metric across two periods. */
export const metricComparisonSchema = z.object({
  title: z.string().describe("What is being compared, e.g. 'Avg pace: this week vs last'"),
  metric: z.string().describe("Metric name, e.g. 'Average pace'"),
  current: z.string().describe("Current-period value with unit, e.g. '5:12 /km'"),
  previous: z.string().describe("Prior-period value with unit, e.g. '5:24 /km'"),
  deltaLabel: z.string().describe("The signed change, e.g. '−0:12' or '+3 bpm'"),
  better: trendDirectionSchema.describe(
    "Whether the current value is an improvement: up/down per the metric, flat if neutral"
  ),
});

/** A coach message grounded in the athlete's progression metrics (#33). */
export const coachInsightSchema = z.object({
  type: coachInsightTypeSchema.describe(
    "insight (observation), warning (risk to act on), milestone (achievement to celebrate)"
  ),
  title: z.string().describe("Short coach headline, ≤ 6 words"),
  body: z.string().describe("One or two sentences of coach guidance, grounded in the data"),
  data: progressionPointSchema.describe("The progression metric backing this message"),
  action: z.string().optional().describe("Optional call to action, e.g. 'Plan an easy week'"),
});

// ---------------------------------------------------------------------------
// Tool registry — what the model is offered
// ---------------------------------------------------------------------------

/**
 * The toolset offered to the model. Kept as real `tool()` definitions so the
 * same typed schemas can also drive a `streamText` tool-calling flow; the
 * streaming analysis endpoint mirrors them as a discriminated union (below) so
 * each generated array element is one validated tool invocation.
 */
export const analysisTools = {
  insightCard: tool({
    description: "Surface a single grounded insight about the athlete's recent training.",
    inputSchema: insightCardSchema,
  }),
  trendCallout: tool({
    description: "Highlight a directional trend (volume, pace, heart rate) over recent weeks.",
    inputSchema: trendCalloutSchema,
  }),
  workoutRecommendation: tool({
    description: "Recommend a specific next workout tailored to the athlete's current form.",
    inputSchema: workoutRecommendationSchema,
  }),
  metricComparison: tool({
    description: "Compare one metric across two time periods, current vs previous.",
    inputSchema: metricComparisonSchema,
  }),
  coachInsight: tool({
    description:
      "Deliver a coach message — insight, warning, or milestone — backed by a progression metric.",
    inputSchema: coachInsightSchema,
  }),
} as const;

export type AnalysisToolName = keyof typeof analysisTools;

// ---------------------------------------------------------------------------
// Streamed block — a discriminated union over the tool inputs
// ---------------------------------------------------------------------------

/**
 * One rendered block in the analysis stream. The `tool` discriminant selects
 * the component; the remaining fields are that tool's validated input. The
 * analysis endpoint streams an array of these, one element at a time.
 */
export const analysisBlockSchema = z.discriminatedUnion("tool", [
  insightCardSchema.extend({ tool: z.literal("insightCard") }),
  trendCalloutSchema.extend({ tool: z.literal("trendCallout") }),
  workoutRecommendationSchema.extend({ tool: z.literal("workoutRecommendation") }),
  metricComparisonSchema.extend({ tool: z.literal("metricComparison") }),
  coachInsightSchema.extend({ tool: z.literal("coachInsight") }),
]);

export type AnalysisBlock = z.infer<typeof analysisBlockSchema>;

/** Narrow a block to the `insightCard` variant (and friends), for the renderer. */
export type AnalysisBlockOf<T extends AnalysisToolName> = Extract<AnalysisBlock, { tool: T }>;

/**
 * Convert a streamed block into the persisted `{ name, args }` shape stored in
 * `ai_analyses.toolCalls` (see types/domain.ts `AnalysisToolCall`).
 */
export function blockToToolCall(block: AnalysisBlock): {
  name: AnalysisToolName;
  args: Record<string, unknown>;
} {
  const { tool: name, ...args } = block;
  return { name, args };
}

/** Reverse of {@link blockToToolCall} — rebuild a block from a persisted tool call. */
export function toolCallToBlock(call: {
  name: string;
  args: Record<string, unknown>;
}): AnalysisBlock | null {
  const candidate = { tool: call.name, ...call.args };
  const parsed = analysisBlockSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
