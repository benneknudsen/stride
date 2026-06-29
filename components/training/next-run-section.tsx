import { BatteryCharging, type LucideIcon, Target, TrendingUp } from "lucide-react";
import type { Goal } from "@/lib/training/goals";
import { NEXT_INDEX, type NextRunDriver, TODAY_INDEX } from "@/lib/training/runs";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./section-heading";

const DRIVER_ICON: Record<NextRunDriver["key"], LucideIcon> = {
  recovery: BatteryCharging,
  trend: TrendingUp,
  plan: Target,
};

/** English week-strip headers, Mon-first, aligned to `goal.week`. The single
 * letters repeat (T, S), so `WEEK_KEYS` carries the stable per-day React key. */
const WEEK_DAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const WEEK_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function DriverCard({ driver }: { driver: NextRunDriver }) {
  const Icon = DRIVER_ICON[driver.key];
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-[13px]">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-bg-2 text-volt">
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {driver.label}
        </div>
        <div className="truncate text-[13px] font-medium text-fg">{driver.value}</div>
      </div>
    </div>
  );
}

/** Section 03 — the recommended next run: the three drivers behind the call,
 * the workout itself (from the committed goal), and where it lands in the week. */
export function NextRunSection({ goal, drivers }: { goal: Goal; drivers: NextRunDriver[] }) {
  const next = goal.next;

  return (
    <section className="pb-[40px] pt-[34px]">
      <SectionHeading index="03" title="Recommended next run" />

      <div className="mb-[14px] grid gap-[14px] sm:grid-cols-3">
        {drivers.map((driver) => (
          <DriverCard key={driver.key} driver={driver} />
        ))}
      </div>

      <div className="grid gap-[14px] lg:grid-cols-[1.5fr_1fr]">
        {/* Workout card */}
        <div className="rounded-[18px] border border-volt/25 bg-gradient-to-br from-volt/[0.08] to-card p-[22px]">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-volt">
              {next.tag}
            </span>
            <span className="rounded-pill border border-border-2 px-[11px] py-[3px] font-mono text-[10.5px] text-sub">
              {next.zone}
            </span>
          </div>

          <div className="mb-[18px] font-display text-[22px] font-semibold tracking-tight text-fg">
            {next.type}
          </div>

          <div className="mb-[18px] grid grid-cols-3 gap-[14px]">
            <div>
              <div className="font-mono text-[20px] font-medium text-fg">{next.distance}</div>
              <div className="mt-0.5 text-[11px] text-muted">Distance</div>
            </div>
            <div>
              <div className="font-mono text-[20px] font-medium text-fg">{next.pace}</div>
              <div className="mt-0.5 text-[11px] text-muted">Target pace</div>
            </div>
            <div>
              <div className="font-mono text-[20px] font-medium text-fg">{next.duration}</div>
              <div className="mt-0.5 text-[11px] text-muted">Duration</div>
            </div>
          </div>

          <div className="border-t border-border pt-[14px] text-[13px] leading-relaxed text-sub">
            {next.why}
          </div>
        </div>

        {/* Week strip */}
        <div className="flex flex-col rounded-[18px] border border-border bg-card p-[22px]">
          <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
            This week
          </div>
          <div className="grid flex-1 grid-cols-4 gap-[6px] sm:grid-cols-7">
            {goal.week.map((session, i) => {
              const isToday = i === TODAY_INDEX;
              const isNext = i === NEXT_INDEX;
              const isRest = session.toLowerCase().startsWith("rest");
              return (
                <div
                  key={WEEK_KEYS[i]}
                  className={cn(
                    "flex flex-col items-center justify-between gap-2 rounded-[10px] border px-1 py-[10px]",
                    isNext
                      ? "border-volt/60 bg-volt/[0.12]"
                      : isToday
                        ? "border-border-2 bg-bg-2"
                        : "border-border bg-bg"
                  )}
                >
                  <span
                    className={cn(
                      "font-mono text-[11px]",
                      isNext ? "text-volt" : isToday ? "text-fg" : "text-muted"
                    )}
                  >
                    {WEEK_DAYS[i]}
                  </span>
                  <span
                    className={cn(
                      "text-center text-[9.5px] leading-tight",
                      isRest ? "text-muted" : isNext ? "text-fg" : "text-sub"
                    )}
                  >
                    {session}
                  </span>
                  <span
                    className={cn(
                      "h-[3px] w-full rounded-full",
                      isNext ? "bg-volt" : isToday ? "bg-border-2" : "bg-transparent"
                    )}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-4 border-t border-border pt-[13px] text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-border-2" /> Today
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-volt" /> Next run
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
