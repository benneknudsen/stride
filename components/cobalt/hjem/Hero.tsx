import { CountUpNumber } from "@/components/cobalt/CountUpNumber";

// Hero band: red mono week-label + two-line serif-italic greeting on the left,
// the giant weekly-km count-up on the right. Sits on the silver paper (no glass)
// so the drifting blobs bleed through behind it.
//
// `note` is the recovery band's sentence (lib/cobalt/hjem.ts) — the same band the
// RecoveryCard reads, so the greeting can't promise a hard session while the card
// below prescribes rest.
export function Hero({
  weekNumber,
  weeklyKm,
  greeting,
  note,
  userName,
  planName,
  started,
}: {
  weekNumber: number;
  weeklyKm: number;
  greeting: string;
  note: string;
  /** Absent for visitors — the greeting then stands alone, unaddressed. */
  userName?: string;
  /** The race the plan builds toward — replaces a hardcoded "Marathonplan". */
  planName: string;
  started: boolean;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6 px-3 pt-[38px] pb-2">
      <div className="min-w-0">
        <div className="mb-3 font-cg-mono text-[11px] uppercase tracking-[0.2em] text-red">
          Uge {weekNumber} · {planName}
        </div>
        <h1 className="m-0 font-cg-serif text-[42px] italic leading-[1.02] tracking-[-0.015em] text-cobalt sm:text-[54px]">
          {userName ? `${greeting}, ${userName}.` : `${greeting}.`}
          <br />
          {note}
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
