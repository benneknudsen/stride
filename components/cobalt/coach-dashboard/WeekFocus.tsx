import Link from "next/link";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { formatDanish } from "@/lib/cobalt/format";
import type { PlanSuggestions } from "@/lib/cobalt/plan";
import { ROUTES } from "@/lib/routes";

// "Ugens forslag" — the three phase-aware runs the week asks for (easy /
// quality / long), beside the card that says which one to do today.
//
// This replaces the Mon–Sun day strip that used to sit here. The plan stopped
// prescribing a specific day per session in #244, so a strip that pinned "tempo
// = Wednesday" contradicted both the plan page and the recommender next to it.
// Same view-model and the same inputs as the plan page (`getPlanSuggestions`),
// so the two pages can't disagree about what the week asks for.
export function WeekFocus({ plan }: { plan: PlanSuggestions }) {
  return (
    <GlassCard className="flex h-full flex-col p-[18px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="cg-label tracking-[0.18em]">Ugens forslag</span>
        <span className="cg-label-sm tracking-[0.12em] text-ink/70">{plan.phaseLabel}-fase</span>
      </div>

      <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
        {plan.suggestions.map((suggestion) => (
          <li
            key={suggestion.type}
            className="flex items-baseline justify-between gap-3 rounded-tile border border-cobalt/20 bg-white/50 px-3 py-2"
          >
            <span className="flex flex-col">
              <span
                className={`text-[13px] font-medium ${
                  suggestion.type === "tempo" ? "text-red" : "text-cobalt"
                }`}
              >
                {suggestion.label}
              </span>
              <span className="text-[11.5px] text-ink">{suggestion.description}</span>
            </span>
            <span className="flex flex-none flex-col items-end">
              <span className="font-cg-display text-[15px] font-bold text-cobalt">
                {formatDanish(suggestion.distanceKm)} km
              </span>
              <span className="font-cg-mono text-[10.5px] text-ink/80">
                {suggestion.paceRange.min}–{suggestion.paceRange.max} /km
              </span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-3">
        <span className="cg-label-sm tracking-[0.12em] text-ink/70">
          {plan.weekKm} km foreslået i ugen
        </span>
        <Link
          href={ROUTES.PLAN}
          className="cg-interactive cg-label-sm tracking-[0.12em] text-cobalt underline-offset-4 hover:underline"
        >
          Se hele planen →
        </Link>
      </div>
    </GlassCard>
  );
}
