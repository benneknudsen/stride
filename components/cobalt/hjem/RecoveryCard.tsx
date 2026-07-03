import { GlassCard } from "@/components/cobalt/GlassCard";

// "Restitution" widget (3/12, red variant): compact red gradient surface with
// the recovery percentage in the display font, a white progress bar and a note
// in the on-red text colour.
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
      <div className="flex items-center justify-between">
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] opacity-85">
          Restitution
        </span>
        <span className="size-2 animate-[cg-pulse-dot_1.8s_ease-in-out_infinite] rounded-full bg-onred motion-reduce:animate-none" />
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-cg-display text-[46px] font-extrabold leading-none tracking-[-0.03em]">
          {pct}
          <span className="text-[22px]">%</span>
        </span>
      </div>

      <div
        className="h-[7px] overflow-hidden rounded-pill"
        style={{ background: "rgba(253, 243, 238, 0.3)" }}
      >
        <div
          className="h-full rounded-pill bg-onred motion-reduce:!transition-none"
          style={{
            width: started ? `${pct}%` : "0%",
            transition: "width 1.2s cubic-bezier(.2,.8,.2,1)",
          }}
        />
      </div>

      <span className="text-[12.5px] opacity-90">{note}</span>
    </GlassCard>
  );
}
