import { GlassCard } from "@/components/cobalt/GlassCard";
import { formatDanish } from "@/lib/cobalt/format";

// "Volumen" widget (4/12): 10 bars of rising cobalt opacity (0.25→1.0) with the
// final bar in red. Each bar grows from the bottom (scaleY) with a staggered
// delay once `started` flips true.
export function VolumeCard({
  bars,
  started,
}: {
  bars: { id: string; km: number }[];
  started: boolean;
}) {
  const max = Math.max(...bars.map((b) => b.km), 1);
  const total = bars.reduce((sum, b) => sum + b.km, 0);
  const n = bars.length;

  return (
    <GlassCard className="flex flex-col justify-between gap-5 rounded-widget p-[22px]">
      <div className="flex items-center justify-between">
        <span className="cg-label tracking-[0.18em]">Volumen</span>
        <span className="cg-label-sm">Seneste 10 ture</span>
      </div>

      <div className="flex h-[120px] items-end gap-[6px]">
        {bars.map((bar, i) => {
          const isLast = i === n - 1;
          const opacity = 0.25 + (i / (n - 1)) * 0.75;
          return (
            <div
              key={bar.id}
              className="flex-1 rounded-[4px] motion-reduce:!transition-none"
              style={{
                height: `${(bar.km / max) * 100}%`,
                minHeight: 6,
                transformOrigin: "bottom",
                transform: started ? "scaleY(1)" : "scaleY(0)",
                transition: `transform 0.7s cubic-bezier(.2,.8,.2,1) ${(i * 0.06).toFixed(2)}s`,
                background: isLast ? "var(--color-red)" : "var(--color-cobalt)",
                opacity: isLast ? 1 : opacity,
              }}
            />
          );
        })}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-cg-display text-[26px] font-bold leading-none tracking-[-0.03em] text-cobalt">
          {formatDanish(total, 1)}
        </span>
        <span className="cg-label">km i alt</span>
      </div>
    </GlassCard>
  );
}
