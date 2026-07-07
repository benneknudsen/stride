import { LogWorkoutButton } from "@/components/cobalt/coach-dashboard/LogWorkoutButton";
import { GlassCard } from "@/components/cobalt/GlassCard";
import type { WorkoutCardView } from "@/lib/coach/dashboard";

// "Næste pas" — the recommender's card (#32) in Cobalt Glass: session type on a
// cobalt surface, the three key numbers in mono, the recommender's reasons, and
// the "Logfør dette pas" quick action.

const TYPE_LABELS: Record<WorkoutCardView["type"], string> = {
  rest: "Hvile",
  easy: "Rolig tur",
  tempo: "Tempo",
  long: "Lang tur",
};

const SHOE_LABELS: Record<WorkoutCardView["shoe"], string> = {
  vomero: "Nike Vomero",
  "adios-pro-4": "Adios Pro 4",
};

export function WorkoutCard({ workout }: { workout: WorkoutCardView }) {
  const isRest = workout.type === "rest";

  return (
    <GlassCard variant="cobalt" className="flex flex-col gap-5 p-[26px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.2em] text-silver/90">
          Næste pas
        </span>
        <span className="rounded-pill bg-silver/15 px-3 py-1 font-cg-mono text-[10.5px] uppercase tracking-[0.14em] text-silver">
          {TYPE_LABELS[workout.type]}
        </span>
      </div>

      {isRest ? (
        <p className="m-0 font-cg-display text-[30px] leading-tight text-silver">Hviledag</p>
      ) : (
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="font-cg-display text-[34px] leading-none text-silver">
              {workout.distanceKm} km
            </div>
            <div className="mt-1 font-cg-mono text-[10.5px] uppercase tracking-[0.14em] text-silver/70">
              Distance
            </div>
          </div>
          <div>
            <div className="font-cg-mono text-[19px] text-silver">
              {workout.paceRange.min}–{workout.paceRange.max}
            </div>
            <div className="mt-1 font-cg-mono text-[10.5px] uppercase tracking-[0.14em] text-silver/70">
              Pace /km
            </div>
          </div>
          <div>
            <div className="font-cg-mono text-[19px] text-silver">≤ {workout.heartRateCap}</div>
            <div className="mt-1 font-cg-mono text-[10.5px] uppercase tracking-[0.14em] text-silver/70">
              Puls bpm
            </div>
          </div>
          <div>
            <div className="text-[15px] text-silver">{SHOE_LABELS[workout.shoe]}</div>
            <div className="mt-1 font-cg-mono text-[10.5px] uppercase tracking-[0.14em] text-silver/70">
              Sko
            </div>
          </div>
        </div>
      )}

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {workout.reason.map((line) => (
          <li key={line} className="flex gap-2 text-[13px] leading-snug text-silver/85">
            <span aria-hidden="true" className="text-red">
              ●
            </span>
            {line}
          </li>
        ))}
      </ul>

      <div>
        <LogWorkoutButton disabled={isRest} />
      </div>
    </GlassCard>
  );
}
