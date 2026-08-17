import { GlassCard } from "@/components/cobalt/GlassCard";
import type { NextActivityView } from "@/lib/coach/next-activity";

// "Næste aktivitet" — the recommendation read off the runner's last five runs
// (the card that replaced the fixed Mon–Sun "Ugens plan" strip). Sits beside the
// phase-driven "Næste pas": a silver glass surface so the cobalt WorkoutCard
// stays the section's primary voice.

const TYPE_LABELS: Record<NextActivityView["type"], string> = {
  rest: "Hvile",
  easy: "Rolig tur",
  tempo: "Tempo",
  long: "Lang tur",
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

      <span className="font-cg-mono text-[10.5px] uppercase tracking-[0.12em] text-ink/70">
        {activity.basis}
      </span>

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
