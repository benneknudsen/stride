import { Lightbulb, Sparkles, TriangleAlert } from "lucide-react";
import type { AnalysisBlockOf, Sentiment } from "@/lib/ai/tools";
import { cn } from "@/lib/utils";

/**
 * Renders an `insightCard` tool invocation — a single grounded observation with
 * a sentiment-tinted accent. One of the four pre-defined generative-UI blocks
 * (see components/ai/analysis-block.tsx).
 */

const SENTIMENT: Record<
  Sentiment,
  { color: string; tint: string; ring: string; Icon: typeof Lightbulb }
> = {
  positive: { color: "text-volt", tint: "bg-volt/10", ring: "border-volt/30", Icon: Sparkles },
  neutral: { color: "text-aqua", tint: "bg-aqua/10", ring: "border-aqua/30", Icon: Lightbulb },
  caution: {
    color: "text-signal",
    tint: "bg-signal/10",
    ring: "border-signal/30",
    Icon: TriangleAlert,
  },
};

export function InsightCard({ block }: { block: AnalysisBlockOf<"insightCard"> }) {
  const s = SENTIMENT[block.sentiment];

  return (
    <div className={cn("rounded-[20px] border bg-card p-5 shadow-float", s.ring)}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control",
            s.tint
          )}
        >
          <s.Icon className={cn("size-4", s.color)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="font-heading text-base font-semibold tracking-tight text-fg">
              {block.title}
            </h4>
            {block.metric ? (
              <span className={cn("tabular shrink-0 text-sm font-semibold", s.color)}>
                {block.metric}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-sub">{block.body}</p>
        </div>
      </div>
    </div>
  );
}
