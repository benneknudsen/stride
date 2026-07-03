import { CountUpNumber } from "@/components/cobalt/CountUpNumber";
import { formatTimerLabel } from "@/lib/cobalt/aktiviteter";

// Activities header: red mono period-label + two-line serif-italic headline on
// the left, three month-totals (km / ture / timer) count-up on the right. Sits
// on the silver paper (no glass), outside the loading overlay, so the totals
// pulse at 0 while data loads and count up when the overlay lifts.
export function ActivitiesHeader({
  periodLabel,
  totalKm,
  totalRuns,
  totalSeconds,
  started,
}: {
  periodLabel: string;
  totalKm: number;
  totalRuns: number;
  totalSeconds: number;
  started: boolean;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6 px-3 pt-[38px] pb-2">
      <div className="min-w-0 [animation:cg-fade-up_0.7s_ease_both] motion-reduce:[animation:none]">
        <div className="mb-3 font-cg-mono text-[11px] uppercase tracking-[0.2em] text-red">
          Aktiviteter · {periodLabel}
        </div>
        <h1 className="m-0 font-cg-serif text-[42px] italic leading-[1.02] tracking-[-0.015em] text-cobalt sm:text-[54px]">
          Alle dine ture,
          <br />
          samlet ét sted.
        </h1>
      </div>

      <div className="flex gap-8 sm:gap-9 [animation:cg-fade-up_0.7s_0.1s_ease_both] motion-reduce:[animation:none]">
        <CountUpNumber
          value={totalKm}
          decimals={1}
          label="km i alt"
          run={started}
          className="text-[40px] text-cobalt sm:text-[44px]"
        />
        <CountUpNumber
          value={totalRuns}
          decimals={0}
          label="ture"
          run={started}
          className="text-[40px] text-cobalt sm:text-[44px]"
        />
        <CountUpNumber
          value={totalSeconds}
          label="timer"
          run={started}
          format={formatTimerLabel}
          className="text-[40px] text-red sm:text-[44px]"
        />
      </div>
    </header>
  );
}
