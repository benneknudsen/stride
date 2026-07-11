import { GlassCard } from "@/components/cobalt/GlassCard";
import type { PlanView } from "@/lib/cobalt/plan";

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-cg-display text-[30px] font-extrabold leading-none">{value}</div>
      <div className="mt-1.5 font-cg-mono text-[9.5px] uppercase tracking-[0.14em] opacity-85">
        {label}
      </div>
    </div>
  );
}

// Race day card — the red goal card. Race name + date, a live days-to-race
// countdown, and the three target numbers (goal time, race pace, AI estimate).
// `onEdit` (signed-in users, issue #99) adds the "Skift race" affordance that
// opens the RaceDateDialog.
export function RaceDayCard({
  race,
  daysToRace,
  onEdit,
}: {
  race: PlanView["race"];
  daysToRace: number;
  onEdit?: () => void;
}) {
  return (
    <GlassCard variant="red" className="px-[26px] py-[22px] text-onred">
      <div className="mb-3 flex items-start justify-between">
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] opacity-85">
          Race day
        </span>
        <span className="flex items-center gap-3">
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="cg-interactive rounded-pill border border-current/40 px-2.5 py-0.5 font-cg-mono text-[9.5px] uppercase tracking-[0.12em] opacity-85 transition-opacity hover:opacity-100"
            >
              Skift race
            </button>
          ) : null}
          <span className="font-cg-mono text-[11px] font-semibold uppercase tracking-[0.12em]">
            {daysToRace} dage
          </span>
        </span>
      </div>

      <div className="font-cg-serif text-[26px] italic leading-[1.2]">
        {race.name}
        <br />
        {race.dayLabel}
      </div>

      <div className="mt-[18px] flex flex-wrap gap-[26px]">
        <Stat value={race.goalTime} label="Måltid" />
        <Stat value={race.racePace} label="Race-pace /km" />
        <Stat value={race.aiEstimate} label="AI-estimat" />
      </div>
    </GlassCard>
  );
}
