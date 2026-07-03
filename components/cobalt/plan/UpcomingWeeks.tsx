import { GlassCard } from "@/components/cobalt/GlassCard";
import type { UpcomingWeek } from "@/lib/cobalt/plan";

// "Kommende uger" — the next block of the plan as compact rows: mono week number,
// focus sentence, and expected volume. The final down-week reads muted.
export function UpcomingWeeks({ weeks }: { weeks: UpcomingWeek[] }) {
  return (
    <GlassCard className="px-[26px] py-[22px]">
      <div className="mb-3.5 font-cg-serif text-[22px] italic text-cobalt">Kommende uger</div>

      {weeks.map((week, i) => (
        <div
          key={week.id}
          className={`flex items-center gap-4 py-3 ${
            i < weeks.length - 1 ? "border-b border-cobalt/15" : ""
          }`}
        >
          <span className="w-14 flex-none font-cg-mono text-[11px] uppercase text-ink">
            Uge {week.week}
          </span>
          <span className="flex-1 text-[14px] font-medium text-cobalt">{week.focus}</span>
          <span
            className={`font-cg-display text-[16px] font-bold ${
              week.muted ? "text-ink" : "text-cobalt"
            }`}
          >
            {week.km} km
          </span>
        </div>
      ))}
    </GlassCard>
  );
}
