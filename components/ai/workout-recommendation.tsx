import { Dumbbell, Gauge, Route } from "lucide-react";
import type { AnalysisBlockOf } from "@/lib/ai/tools";

/**
 * Renders a `workoutRecommendation` tool invocation — a concrete next session
 * with its prescription, rationale, and optional pace/distance targets.
 */
export function WorkoutRecommendation({
  block,
}: {
  block: AnalysisBlockOf<"workoutRecommendation">;
}) {
  return (
    <div className="rounded-[20px] border border-volt/30 bg-card p-5 shadow-float">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control bg-volt/10">
          <Dumbbell className="size-4 text-volt" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-heading text-base font-semibold tracking-tight text-fg">
              {block.title}
            </h4>
            <span className="rounded-pill bg-volt/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-volt">
              {block.workoutType}
            </span>
          </div>
          <p className="mt-1.5 text-sm font-medium text-fg">{block.details}</p>
          <p className="mt-1 text-sm leading-relaxed text-sub">{block.rationale}</p>

          {block.targetPace || typeof block.distanceKm === "number" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {block.targetPace ? (
                <span className="inline-flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1 font-mono text-xs text-sub">
                  <Gauge className="size-3.5 text-aqua" />
                  {block.targetPace}
                </span>
              ) : null}
              {typeof block.distanceKm === "number" ? (
                <span className="inline-flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1 font-mono text-xs text-sub">
                  <Route className="size-3.5 text-aqua" />
                  {block.distanceKm} km
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
