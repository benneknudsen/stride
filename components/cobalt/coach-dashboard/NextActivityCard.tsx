import { GlassCard } from "@/components/cobalt/GlassCard";
import type { NextActivityView } from "@/lib/coach/next-activity";

// "Næste aktivitet" — the *variation* read off the runner's last five runs
// (issue #253): the kind of session the mix is missing, not a second take on
// today's planned pas. Sits beside the plan-grounded "Næste pas" on a silver
// glass surface, so the cobalt WorkoutCard stays the section's primary voice.

const TYPE_LABELS: Record<NextActivityView["type"], string> = {
  rest: "Hvile",
  easy: "Rolig tur",
  long: "Lang Zone 2-tur",
  fartlek: "Fartlek",
  intervals: "Intervaller",
};

export function NextActivityCard({ activity }: { activity: NextActivityView }) {
  const isRest = activity.type === "rest";

  return (
    <GlassCard className="flex h-full flex-col gap-4 p-[22px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="cg-label tracking-[0.18em]">Næste aktivitet</span>
        <span className="rounded-pill bg-cobalt/10 px-3 py-1 cg-label text-[10.5px] text-cobalt">
          {TYPE_LABELS[activity.type]}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="font-cg-mono text-[10.5px] uppercase tracking-[0.12em] text-red">
          Variation · et andet slags pas end planens
        </span>
        <span className="font-cg-mono text-[10.5px] uppercase tracking-[0.12em] text-ink/70">
          {activity.basis}
        </span>
      </div>

      {isRest ? (
        <p className="m-0 font-cg-display text-[26px] leading-tight text-cobalt">Hviledag</p>
      ) : (
        <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
          <div>
            <div className="font-cg-display text-[28px] leading-none text-cobalt">
              {activity.distanceKm} km
            </div>
            <div className="mt-1 cg-label text-[10.5px] text-ink/70">Distance</div>
          </div>
          <div>
            <div className="font-cg-mono text-[17px] text-cobalt">
              {activity.paceRange.min}–{activity.paceRange.max}
            </div>
            <div className="mt-1 cg-label text-[10.5px] text-ink/70">Pace /km</div>
          </div>
          {activity.heartRateCap !== null ? (
            <div>
              <div className="font-cg-mono text-[17px] text-cobalt">≤ {activity.heartRateCap}</div>
              <div className="mt-1 cg-label text-[10.5px] text-ink/70">Puls bpm</div>
            </div>
          ) : null}
        </div>
      )}

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {activity.reason.map((line) => (
          <li key={line} className="flex gap-2 text-[12.5px] leading-snug text-ink">
            <span aria-hidden="true" className="text-red">
              ●
            </span>
            {line}
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}
