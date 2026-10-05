import { GlassCard } from "@/components/cobalt/GlassCard";
import type { AnalysisBlockOf } from "@/lib/ai/tools";

// "Turens gennemgang" — the per-run coach review (issue #298) in Cobalt Glass:
// the run's own numbers, the coach's read of them, when the next run may happen
// (from the engine's recovery window) and which of the week's three suggestions
// is next. Sits on the same silver glass as NextActivityCard so the cobalt
// WorkoutCard stays the section's primary voice.

export function RunReviewCard({ review }: { review: AnalysisBlockOf<"runReview"> }) {
  return (
    <GlassCard className="flex h-full flex-col gap-3 p-[22px]">
      <div className="flex items-start justify-between gap-3">
        <span className="cg-label tracking-[0.18em]">Turens gennemgang</span>
        <span className="rounded-pill bg-cobalt/10 px-2.5 py-1 font-cg-mono text-[11px] font-semibold text-cobalt">
          {review.metric}
        </span>
      </div>

      <h3 className="m-0 font-cg-display text-[19px] leading-tight text-cobalt">{review.title}</h3>

      <p className="m-0 text-[13.5px] leading-relaxed text-ink">{review.body}</p>

      <div className="mt-auto flex flex-col gap-1.5 border-t border-cobalt/10 pt-3">
        <span className="font-cg-mono text-[11px] uppercase tracking-[0.12em] text-red">
          {review.nextRunLabel}
        </span>
        {review.suggestedRun ? (
          <span className="text-[13px] font-semibold text-cobalt">{review.suggestedRun}</span>
        ) : null}
      </div>
    </GlassCard>
  );
}
