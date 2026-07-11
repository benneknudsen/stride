import { GlassCard } from "@/components/cobalt/GlassCard";
import type { ActivityStatView } from "@/lib/cobalt/aktivitet";
import { cn } from "@/lib/utils";

// "Detaljer" — every metric the activity actually carries, as a glass stat grid.
// The view-model omits metrics the run has no data for, so a cell is never a
// dash placeholder; a run with no HR simply shows fewer cells.
export function ActivityStatsCard({ stats }: { stats: ActivityStatView[] }) {
  return (
    <GlassCard className="p-[22px]">
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.key}>
            <div className="font-cg-mono text-[10px] uppercase tracking-[0.14em] text-ink">
              {stat.label}
            </div>
            <div
              className={cn(
                "mt-1.5 font-cg-display text-[26px] font-bold leading-none tracking-[-0.02em]",
                stat.tone === "red" ? "text-red" : "text-cobalt"
              )}
            >
              {stat.value}
            </div>
            <div className="mt-1 font-cg-mono text-[11px] text-ink">{stat.unit}</div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
