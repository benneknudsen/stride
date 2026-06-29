import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { AnalysisBlockOf, TrendDirection } from "@/lib/ai/tools";
import { cn } from "@/lib/utils";

/**
 * Renders a `trendCallout` tool invocation — a directional trend (volume, pace,
 * heart rate) with its current value and change label.
 */

const DIRECTION: Record<TrendDirection, { color: string; tint: string; Icon: typeof TrendingUp }> =
  {
    up: { color: "text-volt", tint: "bg-volt/10", Icon: TrendingUp },
    down: { color: "text-signal", tint: "bg-signal/10", Icon: TrendingDown },
    flat: { color: "text-sub", tint: "bg-card-2", Icon: Minus },
  };

export function TrendCallout({ block }: { block: AnalysisBlockOf<"trendCallout"> }) {
  const d = DIRECTION[block.direction];

  return (
    <div className="rounded-[20px] border border-border bg-card p-5 shadow-float">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{block.title}</p>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 font-mono text-[11px] font-semibold",
            d.tint,
            d.color
          )}
        >
          <d.Icon className="size-3" />
          {block.changeLabel}
        </span>
      </div>
      <p className={cn("tabular mt-2 text-2xl font-semibold", d.color)}>{block.metric}</p>
      <p className="mt-2 text-sm leading-relaxed text-sub">{block.body}</p>
    </div>
  );
}
