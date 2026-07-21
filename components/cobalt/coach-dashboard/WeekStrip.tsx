import { GlassCard } from "@/components/cobalt/GlassCard";
import type { WeekStripDay } from "@/lib/coach/dashboard";
import { cn } from "@/lib/utils";

// Mon–Sun strip under the workout card. Today wears a cobalt ring; the next
// session (often today itself) fills red. Rest days sit dimmed.

const DAY_LABELS: Record<WeekStripDay["weekday"], string> = {
  mon: "man",
  tue: "tir",
  wed: "ons",
  thu: "tor",
  fri: "fre",
  sat: "lør",
  sun: "søn",
};

export function WeekStrip({ days }: { days: WeekStripDay[] }) {
  return (
    <GlassCard className="p-[18px]">
      <span className="cg-label tracking-[0.18em]">Ugens plan</span>
      <div className="mt-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-7 sm:overflow-visible">
        {days.map((day) => {
          const isRest = day.type === "rest";
          return (
            <div
              key={day.weekday}
              aria-current={day.isToday ? "date" : undefined}
              title={day.description}
              className={cn(
                "flex w-[76px] shrink-0 flex-col items-center gap-1 rounded-tile px-1 py-2.5 text-center sm:w-auto",
                day.isNext ? "bg-red text-onred" : isRest ? "text-ink/50" : "text-cobalt",
                day.isToday && !day.isNext && "ring-2 ring-cobalt"
              )}
            >
              <span className="cg-label text-inherit tracking-[0.12em]">
                {DAY_LABELS[day.weekday]}
              </span>
              <span className="text-[11.5px] font-medium leading-tight">{day.description}</span>
              {day.isToday ? (
                <span className="font-cg-mono text-[8.5px] uppercase tracking-[0.14em] opacity-80">
                  i dag
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
