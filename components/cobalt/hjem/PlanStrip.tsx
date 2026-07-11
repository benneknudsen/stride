import Link from "next/link";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { Logo } from "@/components/cobalt/Logo";
import { ROUTES } from "@/lib/routes";

// Slim glass row spanning the full width: logo tile + plan title/goal, a
// cobalt→red progress bar, the red days-to-race counter and a "Se plan" link
// through to /plan.
export function PlanStrip({
  weekOfPlan,
  totalWeeks,
  progressPct,
  daysToRace,
  goalLabel,
  raceDateLabel,
  planTitle,
  started,
}: {
  weekOfPlan: number;
  totalWeeks: number;
  progressPct: number;
  daysToRace: number;
  goalLabel: string;
  raceDateLabel: string;
  /** From the view-model (issue #99) — carries the user's race name. */
  planTitle: string;
  started: boolean;
}) {
  return (
    <GlassCard className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-card px-[22px] py-[16px]">
      <Logo size={40} radius={12} />
      <div className="min-w-0">
        <div className="font-cg-display text-[16px] font-bold tracking-[-0.02em] text-cobalt">
          {planTitle}
        </div>
        <div className="text-[12.5px] text-ink">
          {goalLabel} · {raceDateLabel}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="hidden font-cg-mono text-[10px] uppercase tracking-[0.16em] text-ink sm:inline">
          Uge {weekOfPlan} af {totalWeeks}
        </span>
        <div
          className="h-[8px] flex-1 overflow-hidden rounded-pill"
          style={{ background: "rgba(27, 41, 192, 0.12)" }}
        >
          <div
            className="h-full rounded-pill motion-reduce:!transition-none"
            style={{
              width: started ? `${progressPct}%` : "0%",
              background: "linear-gradient(90deg, var(--color-cobalt), var(--color-red))",
              transition: "width 1.2s cubic-bezier(.2,.8,.2,1)",
            }}
          />
        </div>
      </div>

      <span className="font-cg-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-red">
        {daysToRace} dage til race
      </span>

      <Link
        href={ROUTES.PLAN}
        className="cg-interactive inline-flex min-h-[44px] items-center rounded-pill border px-[18px] py-[7px] font-cg-mono text-[11px] uppercase tracking-[0.12em] text-cobalt transition-colors hover:bg-cobalt/8"
        style={{ borderColor: "rgba(27, 41, 192, 0.3)" }}
      >
        Se plan →
      </Link>
    </GlassCard>
  );
}
