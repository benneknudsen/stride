import Link from "next/link";
import type { Goal } from "@/lib/training/goals";
import { FocusBand } from "./focus-band";
import { GOAL_ICON } from "./goal-icon";

/** The committed-plan header: which goal is active, its focus band, and a
 * route back to the picker to switch plans. */
export function PlanBanner({ goal }: { goal: Goal }) {
  const Icon = GOAL_ICON[goal.key];

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-volt/25 bg-gradient-to-br from-volt/[0.11] to-surface px-4 py-4 sm:px-[26px] sm:py-[22px]">
      <div className="flex items-center gap-3 sm:gap-[18px]">
        <span className="flex size-[52px] items-center justify-center rounded-[15px] bg-volt text-[#0B0D11]">
          <Icon className="size-6" />
        </span>
        <div>
          <div className="mb-[5px] font-mono text-[10.5px] uppercase tracking-[0.14em] text-volt">
            Your plan
          </div>
          <div className="font-display text-[23px] font-semibold tracking-tight text-fg">
            {goal.title}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <FocusBand band={goal.band} />
        <Link
          href="/training/pick"
          className="rounded-[10px] border border-border-2 px-[15px] py-[9px] text-[12.5px] font-medium text-sub transition-colors hover:text-fg"
        >
          Change plan
        </Link>
      </div>
    </div>
  );
}
