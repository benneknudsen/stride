import { GlassCard } from "@/components/cobalt/GlassCard";

// "Readiness" widget (3/12, red variant): compact red gradient surface with
// the readiness percentage in the display font, a white progress bar and a note
// in the on-red text colour. The number is an estimate from training load
// (issue #126) — the caption says so, and nothing on the card signals a live
// measurement.
export function RecoveryCard({
  pct,
  note,
  started,
}: {
  pct: number;
  note: string;
  started: boolean;
}) {
  return (
    <GlassCard
      variant="red"
      className="flex flex-col justify-between gap-4 rounded-widget p-[22px]"
    >
      <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] opacity-85">
        Readiness
      </span>

      <div className="flex items-baseline gap-2">
        <span className="font-cg-display text-[46px] font-extrabold leading-none tracking-[-0.03em]">
          {pct}
          <span className="text-[22px]">%</span>
        </span>
      </div>

      <div
        className="h-[7px] overflow-hidden rounded-pill"
        style={{ background: "color-mix(in srgb, var(--color-onred) 30%, transparent)" }}
      >
        <div
          className="h-full rounded-pill bg-onred motion-reduce:!transition-none"
          style={{
            width: started ? `${pct}%` : "0%",
            transition: "width 1.2s cubic-bezier(.2,.8,.2,1)",
          }}
        />
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px] opacity-90">{note}</span>
        <span className="text-[10.5px] opacity-70">Estimeret ud fra din træningsbelastning</span>
      </div>
    </GlassCard>
  );
}
