import { GlassCard } from "@/components/cobalt/GlassCard";

// "Snit-pace" widget (3/12): an SVG progress ring that sweeps in via
// stroke-dashoffset, the 7-day average pace in the display font at its centre,
// and a red delta note underneath.
const SIZE = 132;
const STROKE = 11;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

export function AvgPaceRing({
  paceLabel,
  fraction,
  deltaLabel,
  started,
}: {
  paceLabel: string;
  fraction: number;
  /** Null when there is no previous week to compare — the note row hides. */
  deltaLabel: string | null;
  started: boolean;
}) {
  const offset = started ? C * (1 - fraction) : C;

  return (
    <GlassCard className="flex flex-col items-center justify-between gap-4 rounded-widget p-[22px]">
      <div className="flex w-full items-center justify-between">
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] text-ink">
          Snit-pace
        </span>
        <span className="font-cg-mono text-[9.5px] uppercase tracking-[0.14em] text-ink">
          7 dage
        </span>
      </div>

      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90" aria-hidden="true">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="rgba(27,41,192,0.12)"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="url(#cg-ring)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
            className="motion-reduce:!transition-none"
            style={{ transition: "stroke-dashoffset 1.4s cubic-bezier(.4,0,.2,1)" }}
          />
          <defs>
            <linearGradient id="cg-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--color-cobalt)" />
              <stop offset="100%" stopColor="var(--color-red)" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-cg-display text-[30px] font-extrabold leading-none tracking-[-0.03em] text-cobalt">
            {paceLabel}
          </span>
          <span className="mt-1 font-cg-mono text-[9px] uppercase tracking-[0.16em] text-ink">
            /km
          </span>
        </div>
      </div>

      {deltaLabel !== null ? (
        <div className="text-center">
          <span className="font-cg-mono text-[12px] font-semibold tracking-[0.04em] text-red">
            {deltaLabel}
          </span>
          <span className="ml-2 text-[11px] text-ink">mod sidste uge</span>
        </div>
      ) : (
        <div className="text-center text-[11px] text-ink">for få ture til sammenligning</div>
      )}
    </GlassCard>
  );
}
