import { Lock } from "lucide-react";
import { GlassCard } from "@/components/cobalt/GlassCard";
import type { PlanView } from "@/lib/cobalt/plan";

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-cg-display text-[30px] font-extrabold leading-none">{value}</div>
      <div className="mt-1.5 cg-label-sm text-onred opacity-85">{label}</div>
    </div>
  );
}

// Race day card — the red goal card. Race name + date, a live days-to-race
// countdown, and the three target numbers (goal time, race pace, AI estimate).
// `onEdit` (signed-in users, issue #99) adds the "Skift race" affordance that
// opens the RaceDateDialog.
//
// When the view-model carries a `lock` (issue #117) there is no prediction to
// show, so the three numbers give way to the lock state: what's missing, and the
// one run that would unlock it. Showing the demo's 3:45/5:20 here would put a
// stranger's race time under the runner's own race name.
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
    <GlassCard variant="red" className="px-[26px] py-[22px] text-onred" data-testid="race-day-card">
      <div className="mb-3 flex items-start justify-between">
        <span className="cg-label text-onred tracking-[0.18em] opacity-85">Race day</span>
        <span className="flex items-center gap-3">
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="cg-interactive rounded-pill border border-current/40 px-2.5 py-0.5 cg-label-sm text-onred tracking-[0.12em] opacity-85 transition-opacity hover:opacity-100"
            >
              Skift race
            </button>
          ) : null}
          <span className="cg-label text-onred text-[11px] font-semibold tracking-[0.12em]">
            {daysToRace} dage
          </span>
        </span>
      </div>

      <div className="font-cg-serif text-[26px] italic leading-[1.2]">
        {race.name}
        <br />
        {race.dayLabel}
      </div>

      {race.lock ? (
        <div
          className="mt-[18px] flex items-start gap-3 rounded-[14px] border border-current/25 bg-current/8 px-3.5 py-3"
          data-testid="race-estimate-lock"
        >
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 opacity-85" />
          <div>
            <div className="cg-label-sm text-onred opacity-85">Estimat låst</div>
            <p className="mt-1.5 max-w-[38ch] text-[13px] leading-[1.45]">{race.lock.message}</p>
          </div>
        </div>
      ) : (
        <div className="mt-[18px] flex flex-wrap gap-[26px]">
          <Stat value={race.goalTime} label="Måltid" />
          <Stat value={race.racePace} label="Race-pace /km" />
          <Stat value={race.aiEstimate} label="AI-estimat" />
        </div>
      )}
    </GlassCard>
  );
}
