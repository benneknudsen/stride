import { Lightbulb, Minus, TrendingDown, TrendingUp, TriangleAlert, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalysisBlockOf, CoachInsightType, TrendDirection } from "@/lib/ai/tools";
import { cn } from "@/lib/utils";

/**
 * Renders a `coachInsight` tool invocation (#33) — a coach message backed by a
 * progression metric: typed icon, title + body, the metric with a trend arrow,
 * and an optional call-to-action.
 */

const TYPE: Record<
  CoachInsightType,
  { color: string; tint: string; ring: string; Icon: typeof Lightbulb }
> = {
  insight: { color: "text-aqua", tint: "bg-aqua/10", ring: "border-aqua/30", Icon: Lightbulb },
  warning: {
    color: "text-signal",
    tint: "bg-signal/10",
    ring: "border-signal/30",
    Icon: TriangleAlert,
  },
  milestone: { color: "text-volt", tint: "bg-volt/10", ring: "border-volt/30", Icon: Trophy },
};

const ARROW: Record<TrendDirection, typeof TrendingUp> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

export function CoachInsight({ block }: { block: AnalysisBlockOf<"coachInsight"> }) {
  const t = TYPE[block.type];
  const Arrow = ARROW[block.data.direction];

  return (
    <div className={cn("rounded-[20px] border bg-card p-5 shadow-float", t.ring)}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control",
            t.tint
          )}
        >
          <t.Icon className={cn("size-4", t.color)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="font-heading text-base font-semibold tracking-tight text-fg">
              {block.title}
            </h4>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 font-mono text-[11px] font-semibold",
                t.tint,
                t.color
              )}
            >
              <Arrow className="size-3" />
              {block.data.value}
              {block.data.changeLabel ? <span>({block.data.changeLabel})</span> : null}
            </span>
          </div>
          <p className="mt-0.5 text-xs font-medium uppercase tracking-[0.14em] text-muted">
            {block.data.label}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-sub">{block.body}</p>
          {block.action ? (
            <Button variant="outline" size="sm" className="mt-3">
              {block.action}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
