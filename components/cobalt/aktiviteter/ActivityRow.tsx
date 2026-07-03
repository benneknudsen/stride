import { GlassCard } from "@/components/cobalt/GlassCard";
import { IntensityMeter } from "@/components/cobalt/IntensityMeter";
import { SourceBadge } from "@/components/cobalt/SourceBadge";
import type { ActivityRowView } from "@/lib/cobalt/aktiviteter";
import { formatDanish } from "@/lib/cobalt/format";
import { cn } from "@/lib/utils";

// One activity as a glass row: the 5-bar IntensityMeter (never a number), name +
// date + plain-language zone, source badge, then km / pace / bpm right-aligned.
// Zone + pace read red on hard efforts, cobalt otherwise. Pace and bpm columns
// fold away on narrow screens so km always stays visible.
export function ActivityRow({ row }: { row: ActivityRowView }) {
  return (
    <GlassCard className="flex items-center gap-4 rounded-card px-[22px] py-4 transition-colors hover:bg-white/[0.58]">
      <IntensityMeter level={row.zone.level} label={`Intensitet: ${row.zone.label}`} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-cobalt">{row.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink">
          <span className="truncate">{row.metaLabel}</span>
          <span aria-hidden="true">·</span>
          <span
            className={cn("font-semibold", row.zone.tone === "red" ? "text-red" : "text-cobalt")}
          >
            {row.zone.label}
          </span>
        </div>
      </div>

      <SourceBadge source={row.source} className="hidden sm:inline-flex" />

      <div className="w-[60px] flex-none text-right sm:w-[86px]">
        <div className="font-cg-display text-[18px] font-bold tracking-[-0.02em] text-cobalt">
          {formatDanish(row.km, 1)}
        </div>
        <div className="font-cg-mono text-[11px] text-ink">km</div>
      </div>

      <div className="hidden w-[86px] flex-none text-right sm:block">
        <div
          className={cn(
            "font-cg-display text-[18px] font-bold tracking-[-0.02em]",
            row.paceTone === "red" ? "text-red" : "text-cobalt"
          )}
        >
          {row.paceLabel}
        </div>
        <div className="font-cg-mono text-[11px] text-ink">/km</div>
      </div>

      <div className="hidden w-[76px] flex-none text-right sm:block">
        <div className="font-cg-display text-[18px] font-bold tracking-[-0.02em] text-cobalt">
          {row.hr}
        </div>
        <div className="font-cg-mono text-[11px] text-ink">bpm</div>
      </div>
    </GlassCard>
  );
}
