import { CountUpNumber } from "@/components/cobalt/CountUpNumber";

// Hero band: red mono week-label + two-line serif-italic greeting on the left,
// the giant weekly-km count-up on the right. Sits on the silver paper (no glass)
// so the drifting blobs bleed through behind it.
export function Hero({
  weekNumber,
  weeklyKm,
  greeting,
  started,
}: {
  weekNumber: number;
  weeklyKm: number;
  greeting: string;
  started: boolean;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6 px-3 pt-[38px] pb-2">
      <div className="min-w-0">
        <div className="mb-3 font-cg-mono text-[11px] uppercase tracking-[0.2em] text-red">
          Uge {weekNumber} · Marathonplan
        </div>
        <h1 className="m-0 font-cg-serif text-[42px] italic leading-[1.02] tracking-[-0.015em] text-cobalt sm:text-[54px]">
          {greeting}, Benjamin.
          <br />
          Kroppen er klar i dag.
        </h1>
      </div>
      <CountUpNumber
        value={weeklyKm}
        decimals={1}
        label="km · denne uge"
        run={started}
        className="items-end text-right text-[64px] text-cobalt sm:text-[80px]"
      />
    </header>
  );
}
