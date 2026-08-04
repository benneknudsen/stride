import { formatDanish } from "@/lib/cobalt/format";
import type { RunSuggestion, SuggestionType } from "@/lib/cobalt/plan";

// Colour tone per run type: the quality pass reads red (hårdt), the easy and long
// runs cobalt (rolig/moderat) — the same cobalt/red split the rest of the plan uses.
const TYPE_TONE: Record<SuggestionType, { accent: string; meta: string }> = {
  easy: { accent: "text-cobalt", meta: "text-cobalt" },
  tempo: { accent: "text-red", meta: "text-red" },
  long: { accent: "text-cobalt", meta: "text-ink" },
};

// One suggestion card. Informational only — the plan no longer prescribes a day
// (issue #244), so nothing here is tappable: the coach reads these and recommends
// which to do today.
function SuggestionCard({ suggestion }: { suggestion: RunSuggestion }) {
  const tone = TYPE_TONE[suggestion.type];
  const km = formatDanish(suggestion.distanceKm);

  return (
    <div className="cg-interactive flex min-h-[132px] flex-col gap-2 rounded-card border border-cobalt/25 bg-white/60 p-4">
      <span className={`cg-label ${suggestion.type === "tempo" ? "font-semibold text-red" : ""}`}>
        {suggestion.label}
      </span>
      <div className="text-[13.5px] text-ink">
        <span className="font-semibold text-cobalt">{km} km</span>
        {" · "}
        <span className={tone.accent}>{suggestion.description}</span>
      </div>
      <div className={`mt-auto font-cg-mono text-[10.5px] ${tone.meta}`}>
        MÅL {suggestion.paceRange.min}–{suggestion.paceRange.max} /km
      </div>
    </div>
  );
}

// This week's suggestions (issue #244): a header row (serif title + mono volume
// overview) and three phase-aware run cards — an easy run, a quality run and a
// long run. Day-agnostic: the coach decides which to do today. Each card fades up
// staggered left→right.
export function WeekSuggestions({
  weekOfPlan,
  phaseLabel,
  weekKm,
  suggestions,
}: {
  weekOfPlan: number;
  phaseLabel: string;
  weekKm: number;
  suggestions: RunSuggestion[];
}) {
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-2 pt-[26px] pb-3">
        <span className="font-cg-serif text-[24px] italic text-cobalt">
          Denne uge — uge {weekOfPlan} · {phaseLabel}-fase
        </span>
        <span className="cg-label text-[10.5px] tracking-[0.12em]">
          {weekKm} km foreslået · baseret på dit race-mål
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {suggestions.map((suggestion, i) => (
          <div
            key={suggestion.type}
            className="[animation:cg-fade-up_0.5s_ease_both] motion-reduce:[animation:none]"
            style={{ animationDelay: `${0.1 + i * 0.05}s` }}
          >
            <SuggestionCard suggestion={suggestion} />
          </div>
        ))}
      </div>
    </section>
  );
}
