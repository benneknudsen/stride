import { GlassCard } from "@/components/cobalt/GlassCard";
import type { CoachView } from "@/lib/cobalt/coach";

// "Træningsbelastning · 14 dage": a 14-bar acute-load chart in the same style as
// the Hjem "Volumen" widget. Bars grow from the bottom (scaleY) with a staggered
// delay once `started`; today's bar (the last) reads red.
export function TrainingLoadCard({ load, started }: { load: CoachView["load"]; started: boolean }) {
  return (
    <GlassCard className="rounded-widget px-[26px] py-[22px]">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] text-ink">
          Træningsbelastning · 14 dage
        </span>
        <span className="font-cg-mono text-[10.5px] text-cobalt">{load.status}</span>
      </div>

      <div className="flex h-[90px] items-end gap-1.5">
        {load.bars.map((bar, i) => (
          <div
            key={bar.id}
            className="flex-1 rounded-[4px] motion-reduce:!transition-none"
            style={{
              height: `${(bar.fraction * 100).toFixed(1)}%`,
              transformOrigin: "bottom",
              transform: started ? "scaleY(1)" : "scaleY(0)",
              transition: `transform 0.7s cubic-bezier(.2,.8,.2,1) ${(0.1 + i * 0.05).toFixed(2)}s`,
              background: bar.accent ? "var(--color-red)" : "var(--color-cobalt)",
              opacity: bar.accent ? 1 : 0.25 + bar.fraction * 0.6,
            }}
          />
        ))}
      </div>

      <p className="mt-3 text-[12px] text-ink">{load.note}</p>
    </GlassCard>
  );
}
