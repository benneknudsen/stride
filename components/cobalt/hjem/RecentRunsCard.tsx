import { GlassCard } from "@/components/cobalt/GlassCard";
import { IntensityMeter } from "@/components/cobalt/IntensityMeter";
import { SourceBadge } from "@/components/cobalt/SourceBadge";
import { formatDanish } from "@/lib/cobalt/format";
import type { RecentRunView } from "@/lib/cobalt/hjem";

// "Seneste ture" widget (7/12): one row per run — the 5-bar IntensityMeter
// (never a number), name + date + plain-language zone, source badge, and the
// km + pace right-aligned. Zone text is red when hard, cobalt when easy/moderate.
export function RecentRunsCard({ runs }: { runs: RecentRunView[] }) {
  return (
    <GlassCard className="flex flex-col rounded-widget p-[26px]">
      <h2 className="m-0 mb-4 font-cg-serif text-[22px] italic tracking-[-0.01em] text-cobalt">
        Seneste ture
      </h2>

      <div className="flex flex-col">
        {runs.map((run, i) => (
          <div
            key={run.id}
            className={`flex items-center gap-4 rounded-card px-2 py-3 transition-colors hover:bg-white/50 ${
              i > 0 ? "border-t" : ""
            }`}
            style={{
              borderColor:
                i > 0 ? "color-mix(in srgb, var(--color-cobalt) 8%, transparent)" : undefined,
            }}
          >
            <IntensityMeter level={run.zone.level} label={`Intensitet: ${run.zone.label}`} />

            <div className="min-w-0 flex-1">
              <div className="truncate font-cg-display text-[16px] font-bold tracking-[-0.02em] text-cobalt">
                {run.name}
              </div>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-ink">{run.dateLabel}</span>
                <span className="text-ink">·</span>
                <span className={run.zone.tone === "red" ? "text-red" : "text-cobalt"}>
                  {run.zone.label}
                </span>
              </div>
            </div>

            <SourceBadge source={run.source} className="hidden sm:inline-flex" />

            <div className="w-[92px] flex-none text-right">
              <div className="font-cg-display text-[17px] font-bold tracking-[-0.02em] text-cobalt">
                {formatDanish(run.km, 1)}
                <span className="ml-1 text-[11px] font-semibold text-ink">km</span>
              </div>
              <div className="font-cg-mono text-[11px] tracking-[0.04em] text-ink">
                {run.paceLabel} /km
              </div>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
