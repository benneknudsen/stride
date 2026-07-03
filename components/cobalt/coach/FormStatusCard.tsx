import { GlassCard } from "@/components/cobalt/GlassCard";
import type { CoachView } from "@/lib/cobalt/coach";
import { cn } from "@/lib/utils";

// "Form-status": current readiness percentage in the display font, a plain-
// language note, and a progress bar that grows out to `pct` once `started`. The
// trend chip (STIGENDE / STABIL / FALDENDE) reads red when form is falling.
export function FormStatusCard({ form, started }: { form: CoachView["form"]; started: boolean }) {
  return (
    <GlassCard className="rounded-widget px-[26px] py-[22px]">
      <div className="mb-3.5 flex items-baseline justify-between">
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] text-ink">
          Form-status
        </span>
        <span
          className={cn(
            "font-cg-mono text-[10.5px]",
            form.trendTone === "red" ? "text-red" : "text-cobalt"
          )}
        >
          {form.trend}
        </span>
      </div>

      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-cg-display text-[42px] font-extrabold leading-none tracking-[-0.03em] text-cobalt">
          {form.pct}
          <span className="text-[20px]">%</span>
        </span>
        <span className="text-[13px] text-ink">{form.note}</span>
      </div>

      <div className="h-[7px] overflow-hidden rounded-pill bg-cobalt/14">
        <div
          className="h-full rounded-pill bg-cobalt motion-reduce:!transition-none"
          style={{
            width: `${form.pct}%`,
            transformOrigin: "left",
            transform: started ? "scaleX(1)" : "scaleX(0)",
            transition: "transform 0.9s 0.3s cubic-bezier(.2,.8,.2,1)",
          }}
        />
      </div>
    </GlassCard>
  );
}
