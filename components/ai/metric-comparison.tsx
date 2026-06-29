import { ArrowRight } from "lucide-react";
import type { AnalysisBlockOf, TrendDirection } from "@/lib/ai/tools";
import { cn } from "@/lib/utils";

/**
 * Renders a `metricComparison` tool invocation — one metric across two periods,
 * previous → current, with the change coloured by whether it's an improvement.
 */

const BETTER: Record<TrendDirection, string> = {
  up: "text-volt",
  down: "text-signal",
  flat: "text-sub",
};

export function MetricComparison({ block }: { block: AnalysisBlockOf<"metricComparison"> }) {
  return (
    <div className="rounded-[20px] border border-border bg-card p-5 shadow-float">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{block.title}</p>
        <span className={cn("tabular text-sm font-semibold", BETTER[block.better])}>
          {block.deltaLabel}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1">
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Previous</p>
          <p className="tabular mt-0.5 text-lg font-medium text-sub">{block.previous}</p>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted" />
        <div className="flex-1 text-right">
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Current</p>
          <p className={cn("tabular mt-0.5 text-lg font-semibold", BETTER[block.better])}>
            {block.current}
          </p>
        </div>
      </div>
    </div>
  );
}
